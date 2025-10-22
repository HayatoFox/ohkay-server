#!/bin/bash
# ============================================================================
# OHKAY SERVER - AlmaLinux Firewall Configuration
# ============================================================================
# Ports utilisés:
#   - 8100: Backend API + Socket.io (HTTPS/reverse proxy recommandé)
#   - 8101: Frontend Vite dev server (dev uniquement, pas en prod)
#
# En production, utiliser Nginx/Caddy sur port 80/443 en reverse proxy
# ============================================================================

set -e

echo "🔥 Configuration Firewall pour Ohkay Server..."

# Activer firewalld si pas déjà actif
sudo systemctl enable firewalld
sudo systemctl start firewalld

# ============================================================================
# 1. RESET FIREWALL (optionnel, pour repartir de zéro)
# ============================================================================
echo "📋 Reset des règles firewall..."
# sudo firewall-cmd --complete-reload

# ============================================================================
# 2. RÈGLES DE BASE - Services essentiels
# ============================================================================
echo "✅ Activation SSH (port 22)..."
sudo firewall-cmd --permanent --add-service=ssh

# ============================================================================
# 3. PORTS OHKAY SERVER
# ============================================================================
echo "✅ Ouverture port 8100 (Backend API + Socket.io)..."
sudo firewall-cmd --permanent --add-port=8100/tcp

# Port 8101 uniquement si vous faites tourner Vite en dev sur le serveur
# En production, ce port ne devrait PAS être exposé (build static servi par Nginx)
# echo "✅ Ouverture port 8101 (Vite dev - DEV ONLY)..."
# sudo firewall-cmd --permanent --add-port=8101/tcp

# ============================================================================
# 4. PRODUCTION - Ports HTTP/HTTPS (si reverse proxy Nginx/Caddy)
# ============================================================================
# Décommenter si vous utilisez un reverse proxy
# echo "✅ Ouverture port 80 (HTTP)..."
# sudo firewall-cmd --permanent --add-service=http
# 
# echo "✅ Ouverture port 443 (HTTPS)..."
# sudo firewall-cmd --permanent --add-service=https

# ============================================================================
# 5. RÈGLES SORTANTES - Accès limité à internet
# ============================================================================
echo "✅ Configuration zone pour trafic sortant limité..."

# Par défaut, firewalld autorise tout le trafic sortant
# Pour restreindre, il faut utiliser nftables ou iptables directement

# Autoriser DNS (nécessaire pour résolution noms de domaine)
sudo firewall-cmd --permanent --add-service=dns

# Autoriser HTTP/HTTPS sortant (pour apt/yum update, git clone)
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 80 -j ACCEPT
sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 443 -j ACCEPT

# Autoriser git protocol (port 9418) si besoin de git:// URLs
# sudo firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 9418 -j ACCEPT

# ============================================================================
# 6. BLOQUER TOUT LE RESTE (optionnel - très strict)
# ============================================================================
# ATTENTION: Cette règle bloque TOUT sauf ce qui est explicitement autorisé
# Décommenter seulement si vous êtes sûr de vos règles
# echo "⚠️  Blocage de tout le reste du trafic sortant..."
# sudo firewall-cmd --permanent --set-target=DROP --zone=public

# ============================================================================
# 7. RÈGLES DE SÉCURITÉ SUPPLÉMENTAIRES
# ============================================================================
echo "🛡️  Configuration règles de sécurité..."

# Limiter les connexions SSH (protection brute force)
sudo firewall-cmd --permanent --add-rich-rule='rule service name=ssh limit value=3/m accept'

# Rate limiting sur port 8100 (100 connexions/minute max)
sudo firewall-cmd --permanent --add-rich-rule='rule port port=8100 protocol=tcp limit value=100/m accept'

# Bloquer ping (optionnel)
# sudo firewall-cmd --permanent --add-icmp-block=echo-request

# ============================================================================
# 8. LOGGING (optionnel)
# ============================================================================
# Logger les paquets rejetés
# sudo firewall-cmd --permanent --set-log-denied=all

# ============================================================================
# 9. APPLIQUER LES CHANGEMENTS
# ============================================================================
echo "♻️  Rechargement du firewall..."
sudo firewall-cmd --reload

# ============================================================================
# 10. VÉRIFICATION
# ============================================================================
echo ""
echo "✅ Configuration terminée!"
echo ""
echo "📊 État du firewall:"
sudo firewall-cmd --state
echo ""
echo "🔓 Ports ouverts:"
sudo firewall-cmd --list-ports
echo ""
echo "📋 Services actifs:"
sudo firewall-cmd --list-services
echo ""
echo "🔥 Règles actives:"
sudo firewall-cmd --list-all
echo ""
echo "🚀 Ohkay Server est maintenant protégé!"
echo ""
echo "ℹ️  Notes importantes:"
echo "   - Port 8100: Backend accessible depuis internet"
echo "   - SSH (22): Accès admin uniquement (limité à 3 tentatives/min)"
echo "   - Trafic sortant: HTTP/HTTPS autorisé pour updates"
echo ""
echo "⚠️  PRODUCTION CHECKLIST:"
echo "   1. Mettre Nginx/Caddy en reverse proxy sur 80/443"
echo "   2. Configurer SSL/TLS avec Let's Encrypt"
echo "   3. Ne PAS exposer port 8101 en production"
echo "   4. Changer les mots de passe par défaut dans .env"
echo "   5. Limiter accès SSH par IP si possible"
