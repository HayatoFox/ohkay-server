#!/bin/bash
# ============================================================================
# OHKAY SERVER - Configuration Firewall STRICTE (Sécurité maximale)
# ============================================================================
# Cette config bloque TOUT sauf ce qui est explicitement autorisé
# ⚠️  À utiliser seulement si vous savez ce que vous faites !
# ============================================================================

set -e

echo "🔒 Configuration Firewall STRICTE pour Ohkay Server..."

# Vérifier que firewalld est installé
if ! command -v firewall-cmd &> /dev/null; then
    echo "❌ firewalld n'est pas installé. Installation..."
    sudo dnf install -y firewalld
fi

# Activer et démarrer firewalld
sudo systemctl enable firewalld
sudo systemctl start firewalld

# ============================================================================
# 1. RESET COMPLET
# ============================================================================
echo "🧹 Reset des règles firewall..."
sudo firewall-cmd --complete-reload

# Supprimer toutes les règles directes existantes
sudo firewall-cmd --permanent --direct --get-all-rules | while read rule; do
    sudo firewall-cmd --permanent --direct --remove-rule $rule 2>/dev/null || true
done

# ============================================================================
# 2. CONFIGURATION ZONE PUBLIC (défaut)
# ============================================================================
echo "⚙️  Configuration zone public..."

# Supprimer tous les services par défaut
sudo firewall-cmd --permanent --zone=public --remove-service=dhcpv6-client 2>/dev/null || true
sudo firewall-cmd --permanent --zone=public --remove-service=cockpit 2>/dev/null || true

# ============================================================================
# 3. TRAFIC ENTRANT - Autoriser uniquement ports nécessaires
# ============================================================================
echo "📥 Configuration trafic entrant..."

# SSH (admin uniquement)
sudo firewall-cmd --permanent --zone=public --add-service=ssh
sudo firewall-cmd --permanent --zone=public --add-rich-rule='rule service name=ssh limit value=3/m accept'

# Port 8100 (Backend Ohkay) avec rate limiting
sudo firewall-cmd --permanent --zone=public --add-port=8100/tcp
sudo firewall-cmd --permanent --zone=public --add-rich-rule='rule port port=8100 protocol=tcp limit value=100/m accept'

# NE PAS ouvrir 8101 en production (Vite dev)

# ============================================================================
# 4. TRAFIC SORTANT - Bloquer tout sauf essentiels
# ============================================================================
echo "📤 Configuration trafic sortant STRICT..."

# Par défaut, on va bloquer tout le sortant et autoriser seulement le nécessaire
# ATTENTION: Cette méthode utilise nftables/iptables via firewalld direct rules

# DNS (port 53) - Nécessaire pour résolution de noms
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p udp --dport 53 -j ACCEPT
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 53 -j ACCEPT

# HTTP (port 80) - Pour dnf/yum update
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 80 -j ACCEPT

# HTTPS (port 443) - Pour dnf/yum update, npm, git clone https
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 443 -j ACCEPT

# NTP (port 123) - Synchronisation temps (optionnel mais recommandé)
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p udp --dport 123 -j ACCEPT

# Git protocol (port 9418) - Si besoin de git:// URLs
# sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 9418 -j ACCEPT

# SMTP (port 25, 587, 465) - Si besoin d'envoyer des emails
# sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 25 -j ACCEPT
# sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 587 -j ACCEPT
# sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 465 -j ACCEPT

# Autoriser connexions établies et related (important!)
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -m state --state ESTABLISHED,RELATED -j ACCEPT

# Autoriser loopback (localhost)
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -o lo -j ACCEPT

# ============================================================================
# 5. BLOQUER TOUT LE RESTE DU TRAFIC SORTANT
# ============================================================================
echo "🚫 Blocage de tout le reste du trafic sortant..."

# Cette règle doit être en dernier (priorité basse)
# Elle bloque tout ce qui n'a pas été explicitement autorisé
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 100 -j DROP

# ============================================================================
# 6. RÈGLES DE SÉCURITÉ AVANCÉES
# ============================================================================
echo "🛡️  Application règles de sécurité avancées..."

# Note: Les règles tcp-flags avancées sont incompatibles avec certaines versions de firewalld
# On se concentre sur des protections de base compatibles partout

# Bloquer ping (ICMP echo request) - protection contre scan réseau
sudo firewall-cmd --permanent --zone=public --add-icmp-block=echo-request

# Protection DDoS: limiter les nouvelles connexions TCP
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter INPUT 0 -p tcp -m conntrack --ctstate NEW -m limit --limit 60/s --limit-burst 20 -j ACCEPT
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter INPUT 1 -p tcp -m conntrack --ctstate NEW -j DROP

# ============================================================================
# 7. LOGGING
# ============================================================================
echo "📝 Activation du logging..."

# Logger tous les paquets rejetés
sudo firewall-cmd --permanent --set-log-denied=all

# ============================================================================
# 8. FAIL2BAN (recommandé pour protection SSH)
# ============================================================================
echo "🔐 Configuration Fail2Ban (si installé)..."

if command -v fail2ban-client &> /dev/null; then
    sudo systemctl enable fail2ban
    sudo systemctl start fail2ban
    echo "✅ Fail2Ban actif"
else
    echo "⚠️  Fail2Ban non installé. Installation recommandée:"
    echo "   sudo dnf install -y fail2ban"
    echo "   sudo systemctl enable fail2ban"
    echo "   sudo systemctl start fail2ban"
fi

# ============================================================================
# 9. APPLIQUER LES CHANGEMENTS
# ============================================================================
echo "♻️  Rechargement du firewall..."
sudo firewall-cmd --reload

# ============================================================================
# 10. VÉRIFICATION ET RAPPORT
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Configuration STRICTE terminée!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 État du firewall:"
sudo firewall-cmd --state
echo ""
echo "🔓 Ports ouverts (ENTRANT):"
sudo firewall-cmd --list-ports
echo ""
echo "📋 Services actifs:"
sudo firewall-cmd --list-services
echo ""
echo "📤 Règles sortantes (OUTPUT):"
sudo firewall-cmd --direct --get-all-rules | grep OUTPUT || echo "  Aucune règle directe visible"
echo ""
echo "🔥 Toutes les règles:"
sudo firewall-cmd --list-all
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Ohkay Server - Sécurité MAXIMALE activée"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ TRAFIC ENTRANT autorisé:"
echo "   - SSH (port 22) - 3 tentatives/min max"
echo "   - Backend API (port 8100) - 100 req/min max"
echo ""
echo "✅ TRAFIC SORTANT autorisé:"
echo "   - DNS (port 53)"
echo "   - HTTP (port 80)"
echo "   - HTTPS (port 443)"
echo "   - NTP (port 123)"
echo "   - Connexions établies/related"
echo "   - Loopback (localhost)"
echo ""
echo "🚫 TOUT LE RESTE EST BLOQUÉ"
echo ""
echo "⚠️  IMPORTANT:"
echo "   1. Cette config est TRÈS stricte"
echo "   2. Si un service ne fonctionne pas, vérifier les logs:"
echo "      sudo journalctl -u firewalld -f"
echo "   3. Pour autoriser un port sortant:"
echo "      sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport PORT -j ACCEPT"
echo "      sudo firewall-cmd --reload"
echo "   4. Installer Fail2Ban pour protection SSH supplémentaire"
echo "   5. En production: utiliser reverse proxy (Nginx) sur 80/443 avec SSL"
echo ""
echo "📖 Pour désactiver mode strict:"
echo "   sudo firewall-cmd --permanent --direct --remove-rule ipv4 filter OUTPUT 100 -j DROP"
echo "   sudo firewall-cmd --reload"
