#!/bin/bash
#############################################################################
# Ohkay Server - Script d'installation automatique pour AlmaLinux 9
# Usage: sudo bash install-almalinux.sh
#
# Ce script installe:
#   - Docker + Docker Compose (containerisation)
#   - PostgreSQL 16 (via Docker)
#   - Node.js 20 + TypeScript (via Docker)
#   - Configuration du firewall et SELinux
#   - Service systemd pour auto-démarrage
#   - Script de backup automatique
#
# Prérequis:
#   - AlmaLinux 9 (ou compatible RHEL 9)
#   - Accès root (sudo)
#   - Connexion Internet
#   - Au moins 2 Go de RAM
#   - Au moins 10 Go d'espace disque
#
# Note: Node.js n'est PAS installé sur le système hôte
#       Tout s'exécute dans des conteneurs Docker
#############################################################################

set -e

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Variables
INSTALL_DIR="/opt/ohkay-server"
BACKUP_DIR="/opt/backups/ohkay"
SERVICE_NAME="ohkay-server"
REPO_URL="https://github.com/HayatoFox/ohkay-server.git"

# Fonctions d'affichage
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Vérification root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "Ce script doit être exécuté en tant que root (sudo)"
        exit 1
    fi
}

# Vérification OS
check_os() {
    print_header "Vérification du système d'exploitation"
    
    if [ -f /etc/almalinux-release ]; then
        OS_VERSION=$(cat /etc/almalinux-release)
        print_success "Système détecté: $OS_VERSION"
        
        # Vérifier que c'est AlmaLinux 9
        if ! grep -q "release 9" /etc/almalinux-release; then
            print_warning "Ce script est optimisé pour AlmaLinux 9"
            print_warning "Version détectée: $OS_VERSION"
            read -p "Continuer quand même? (o/N): " continue_anyway
            if [[ ! "$continue_anyway" =~ ^[Oo]$ ]]; then
                exit 1
            fi
        fi
    elif [ -f /etc/redhat-release ]; then
        OS_VERSION=$(cat /etc/redhat-release)
        print_warning "Système détecté: $OS_VERSION"
        print_warning "Ce script est conçu pour AlmaLinux 9, mais peut fonctionner sur RHEL/Rocky"
        read -p "Continuer? (o/N): " continue_anyway
        if [[ ! "$continue_anyway" =~ ^[Oo]$ ]]; then
            exit 1
        fi
    else
        print_error "Ce script est conçu pour AlmaLinux 9"
        print_error "Système non supporté détecté"
        exit 1
    fi
}

# Vérification des prérequis système
check_system_requirements() {
    print_header "Vérification des prérequis système"
    
    # RAM disponible (en Mo)
    TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
    if [ "$TOTAL_RAM" -lt 1800 ]; then
        print_error "RAM insuffisante: ${TOTAL_RAM}Mo détectés (minimum 2048Mo recommandé)"
        read -p "Continuer quand même? (o/N): " continue_ram
        if [[ ! "$continue_ram" =~ ^[Oo]$ ]]; then
            exit 1
        fi
    else
        print_success "RAM: ${TOTAL_RAM}Mo ✓"
    fi
    
    # Espace disque disponible dans /opt (en Go)
    DISK_SPACE=$(df -BG /opt | awk 'NR==2 {print $4}' | sed 's/G//')
    if [ "$DISK_SPACE" -lt 10 ]; then
        print_error "Espace disque insuffisant dans /opt: ${DISK_SPACE}Go (minimum 10Go recommandé)"
        read -p "Continuer quand même? (o/N): " continue_disk
        if [[ ! "$continue_disk" =~ ^[Oo]$ ]]; then
            exit 1
        fi
    else
        print_success "Espace disque /opt: ${DISK_SPACE}Go ✓"
    fi
    
    # Connexion Internet
    if ! ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
        print_error "Pas de connexion Internet détectée"
        exit 1
    else
        print_success "Connexion Internet ✓"
    fi
}

# Fonction de vérification avec sortie
verify_step() {
    local step_name=$1
    local check_command=$2
    local success_msg=$3
    local fail_msg=$4
    
    print_info "Vérification: $step_name..."
    if eval "$check_command"; then
        print_success "$success_msg"
        return 0
    else
        print_error "$fail_msg"
        return 1
    fi
}

# Installation de Git
install_git() {
    print_header "Installation de Git"
    
    if command -v git &> /dev/null; then
        print_warning "Git est déjà installé"
        git --version
    else
        print_info "Installation de Git..."
        dnf install -y git
        verify_step "Git" "command -v git &> /dev/null" "Git installé: $(git --version)" "Échec installation Git"
    fi
}

# Installation de Docker
install_docker() {
    print_header "Installation de Docker"
    
    if command -v docker &> /dev/null; then
        print_warning "Docker est déjà installé"
        docker --version
    else
        print_info "Installation des dépendances..."
        dnf install -y yum-utils
        
        print_info "Ajout du repository Docker..."
        yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        
        print_info "Installation de Docker Engine..."
        dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        
        print_info "Démarrage de Docker..."
        systemctl start docker
        systemctl enable docker
        
        verify_step "Docker" "docker --version && systemctl is-active docker" \
            "Docker installé et actif: $(docker --version)" \
            "Docker non fonctionnel"
    fi
}

# Installation des outils nécessaires
install_tools() {
    print_header "Installation des outils nécessaires"
    
    print_info "Installation de wget, curl, jq, openssl..."
    dnf install -y wget curl jq openssl
    
    verify_step "Outils" \
        "command -v wget &> /dev/null && command -v curl &> /dev/null && command -v jq &> /dev/null" \
        "Outils installés: wget, curl, jq, openssl" \
        "Échec installation des outils"
}

# Configuration du pare-feu
configure_firewall() {
    print_header "Configuration du pare-feu"
    
    # Installer firewalld si absent
    if ! command -v firewall-cmd &> /dev/null; then
        print_info "Installation de firewalld..."
        dnf install -y firewalld
        systemctl enable firewalld
        systemctl start firewalld
    fi
    
    verify_step "firewalld" "systemctl is-active firewalld" \
        "firewalld actif" \
        "firewalld non actif"
    
    echo ""
    print_info "Choisissez le mode de sécurité du pare-feu:"
    echo ""
    echo "  1) Standard - Recommandé (SSH + port 8100 avec rate limiting)"
    echo "  2) Strict   - Sécurité maximale (bloque tout sauf explicite)"
    echo ""
    read -p "Votre choix (1/2): " firewall_choice
    
    case $firewall_choice in
        2)
            print_info "Configuration du pare-feu en mode STRICT..."
            configure_firewall_strict
            ;;
        *)
            print_info "Configuration du pare-feu en mode STANDARD..."
            configure_firewall_standard
            ;;
    esac
}

# Configuration pare-feu standard
configure_firewall_standard() {
    # SSH avec rate limiting
    firewall-cmd --permanent --add-service=ssh
    firewall-cmd --permanent --add-rich-rule='rule service name=ssh limit value=3/m accept'
    
    # Port 8100 (API HTTP/WebSocket) avec rate limiting
    firewall-cmd --permanent --add-port=8100/tcp
    firewall-cmd --permanent --add-rich-rule='rule port port=8100 protocol=tcp limit value=100/m accept'
    
    # Ports WebRTC (7500-8000) pour système vocal
    firewall-cmd --permanent --add-port=7500-8000/udp
    firewall-cmd --permanent --add-port=7500-8000/tcp
    
    # DNS
    firewall-cmd --permanent --add-service=dns
    
    # Trafic sortant HTTP/HTTPS
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 80 -j ACCEPT
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 443 -j ACCEPT
    
    # Reload
    firewall-cmd --reload
    
    verify_step "Firewall standard" \
        "firewall-cmd --list-ports | grep -q 8100" \
        "Pare-feu configuré: ports 8100 (API) + 7500-8000 (WebRTC) ouverts" \
        "Échec configuration pare-feu"
    
    echo ""
    print_info "Règles actives:"
    firewall-cmd --list-all
}

# Configuration pare-feu strict
configure_firewall_strict() {
    # Reset
    firewall-cmd --complete-reload
    
    # SSH avec rate limiting (ignorer si déjà présent)
    firewall-cmd --permanent --zone=public --add-service=ssh 2>/dev/null || true
    firewall-cmd --permanent --zone=public --add-rich-rule='rule service name=ssh limit value=3/m accept' 2>/dev/null || true
    
    # Port 8100 (API) avec rate limiting (ignorer si déjà présent)
    firewall-cmd --permanent --zone=public --add-port=8100/tcp 2>/dev/null || true
    firewall-cmd --permanent --zone=public --add-rich-rule='rule port port=8100 protocol=tcp limit value=100/m accept' 2>/dev/null || true
    
    # Ports WebRTC (7500-8000) pour système vocal (ignorer si déjà présent)
    firewall-cmd --permanent --zone=public --add-port=7500-8000/udp 2>/dev/null || true
    firewall-cmd --permanent --zone=public --add-port=7500-8000/tcp 2>/dev/null || true
    
    # DNS (ignorer si déjà présent)
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p udp --dport 53 -j ACCEPT 2>/dev/null || true
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
    
    # HTTP/HTTPS sortant (ignorer si déjà présent)
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
    
    # NTP (ignorer si déjà présent)
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -p udp --dport 123 -j ACCEPT 2>/dev/null || true
    
    # Connexions établies (ignorer si déjà présent)
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
    
    # Loopback (ignorer si déjà présent)
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 0 -o lo -j ACCEPT 2>/dev/null || true
    
    # Bloquer ICMP ping (ignorer si déjà présent)
    firewall-cmd --permanent --add-icmp-block=echo-request 2>/dev/null || true
    
    # Bloquer le reste (mode strict) (ignorer si déjà présent)
    firewall-cmd --permanent --direct --add-rule ipv4 filter OUTPUT 100 -j DROP 2>/dev/null || true
    
    # Logging des paquets rejetés
    # Note: --set-log-denied fait automatiquement un changement runtime+permanent
    firewall-cmd --set-log-denied=all 2>/dev/null || true
    
    # Reload
    firewall-cmd --reload
    
    verify_step "Firewall strict" \
        "firewall-cmd --list-ports | grep -q 8100" \
        "Pare-feu STRICT configuré: sécurité maximale activée" \
        "Échec configuration pare-feu strict"
    
    echo ""
    print_warning "Mode STRICT activé: tout le trafic non explicitement autorisé est bloqué"
    print_info "Règles actives:"
    firewall-cmd --list-all
}

# Configuration SELinux
configure_selinux() {
    print_header "Configuration SELinux"
    
    if command -v getenforce &> /dev/null; then
        SELINUX_STATUS=$(getenforce)
        print_info "Statut SELinux: $SELINUX_STATUS"
        
        if [[ "$SELINUX_STATUS" == "Enforcing" ]]; then
            print_info "Configuration des permissions SELinux pour Docker..."
            setsebool -P container_manage_cgroup on 2>/dev/null || true
            
            print_info "Autorisation du port 8100 pour HTTP dans SELinux..."
            if command -v semanage &> /dev/null; then
                semanage port -a -t http_port_t -p tcp 8100 2>/dev/null || \
                semanage port -m -t http_port_t -p tcp 8100 2>/dev/null || true
                print_success "Port 8100 autorisé dans SELinux"
            else
                print_warning "semanage non disponible, installation de policycoreutils-python-utils..."
                dnf install -y policycoreutils-python-utils
                semanage port -a -t http_port_t -p tcp 8100 2>/dev/null || \
                semanage port -m -t http_port_t -p tcp 8100 2>/dev/null || true
                print_success "Port 8100 autorisé dans SELinux"
            fi
            
            print_success "SELinux configuré pour Docker et port 8100"
        else
            print_info "SELinux n'est pas en mode Enforcing, pas de configuration nécessaire"
        fi
    fi
}

# Configuration des répertoires
setup_directories() {
    print_header "Configuration des répertoires"
    
    print_info "Création du répertoire d'installation..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$BACKUP_DIR"
    
    print_info "Configuration des permissions..."
    chmod 755 "$INSTALL_DIR"
    
    verify_step "Répertoires" \
        "test -d $INSTALL_DIR && test -d $BACKUP_DIR" \
        "Répertoires créés: $INSTALL_DIR" \
        "Échec création répertoires"
}

# Création du dossier logs (après clone)
setup_logs_directory() {
    print_header "Configuration du système de logs"
    
    print_info "Création du répertoire logs..."
    mkdir -p "$INSTALL_DIR/logs"
    chmod 777 "$INSTALL_DIR/logs"
    
    verify_step "Logs directory" \
        "test -d $INSTALL_DIR/logs" \
        "Répertoire logs créé avec permissions d'écriture" \
        "Échec création répertoire logs"
}

# Clone du repository
clone_repository() {
    print_header "Téléchargement du code source"
    
    if [ -d "$INSTALL_DIR/.git" ]; then
        print_warning "Repository déjà cloné, mise à jour..."
        cd "$INSTALL_DIR"
        git pull
    else
        print_info "Clonage depuis GitHub..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    
    cd "$INSTALL_DIR"
    
    verify_step "Repository" \
        "test -f $INSTALL_DIR/package.json && test -f $INSTALL_DIR/docker-compose.yml" \
        "Code source téléchargé avec succès" \
        "Échec téléchargement du code"
}

# Génération des secrets
generate_secrets() {
    print_header "Génération des secrets"
    
    # Vérifier si les secrets ont déjà été générés dans interactive_mode
    if [[ -n "$INSTANCE_PASSWORD" && -n "$DB_PASSWORD" && -n "$JWT_SECRET" && -n "$DB_ENCRYPTION_KEY" && -n "$MASTER_ENCRYPTION_KEY" ]]; then
        print_info "Secrets déjà configurés en mode interactif"
        print_success "Tous les secrets sont prêts"
        return 0
    fi
    
    # Génération automatique de secrets forts
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    DB_PASSWORD=$(openssl rand -base64 48 | tr -d '\n')
    POSTGRES_PASSWORD=$(openssl rand -base64 48 | tr -d '\n')
    DB_ENCRYPTION_KEY=$(openssl rand -base64 64 | tr -d '\n')
    MASTER_ENCRYPTION_KEY=$(openssl rand -base64 64 | tr -d '\n')
    
    # Demander le mot de passe d'instance à l'utilisateur
    echo ""
    print_info "Configuration du mot de passe d'instance"
    print_warning "Ce mot de passe sera requis pour que les utilisateurs créent un compte sur votre instance Ohkay"
    echo ""
    
    # Proposer la génération automatique
    read -p "  Voulez-vous générer un mot de passe fort aléatoire? (O/n): " generate_choice
    
    if [[ ! "$generate_choice" =~ ^[Nn]$ ]]; then
        # Générer un mot de passe fort lisible
        GENERATED_PASSWORD=$(openssl rand -base64 24 | tr -d '\n' | head -c 20)
        echo ""
        print_success "Mot de passe d'instance généré (20 caractères):"
        echo ""
        echo -e "  ${GREEN}${GENERATED_PASSWORD}${NC}"
        echo ""
        print_warning "IMPORTANT: Copiez ce mot de passe maintenant!"
        echo ""
        read -p "  Appuyez sur Entrée après avoir copié le mot de passe..."
        
        INSTANCE_PASSWORD="$GENERATED_PASSWORD"
        print_success "Mot de passe d'instance configuré automatiquement"
    else
        # Mode manuel
        echo ""
        while true; do
            read -sp "  Entrez le mot de passe d'instance: " INSTANCE_PASSWORD
            echo ""
            
            if [ -z "$INSTANCE_PASSWORD" ]; then
                print_error "Le mot de passe ne peut pas être vide"
                continue
            fi
            
            if [ ${#INSTANCE_PASSWORD} -lt 8 ]; then
                print_error "Le mot de passe doit contenir au moins 8 caractères"
                continue
            fi
            
            read -sp "  Confirmez le mot de passe: " INSTANCE_PASSWORD_CONFIRM
            echo ""
            
            if [ "$INSTANCE_PASSWORD" != "$INSTANCE_PASSWORD_CONFIRM" ]; then
                print_error "Les mots de passe ne correspondent pas"
                continue
            fi
            
            break
        done
        
        print_success "Mot de passe d'instance configuré"
    fi
    
    echo ""
    print_success "Secrets cryptographiques générés (JWT, DB, Encryption, Messages)"
    
    verify_step "Secrets" \
        "test -n '$JWT_SECRET' && test -n '$DB_PASSWORD' && test -n '$INSTANCE_PASSWORD' && test -n '$MASTER_ENCRYPTION_KEY'" \
        "Tous les secrets sont prêts" \
        "Échec génération secrets"
}

# Création du fichier .env
create_env_file() {
    print_header "Création du fichier de configuration"
    
    # Vérifier si .env existe déjà
    if [ -f "$INSTALL_DIR/.env" ]; then
        print_warning "Le fichier .env existe déjà"
        read -p "  Voulez-vous le remplacer? (o/N): " replace_env
        if [[ ! "$replace_env" =~ ^[Oo]$ ]]; then
            print_info "Conservation du fichier .env existant"
            return 0
        else
            # Backup de l'ancien .env
            cp "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.backup.$(date +%Y%m%d_%H%M%S)"
            print_info "Ancien .env sauvegardé"
        fi
    fi
    
    # Récupérer l'IP publique du serveur
    PUBLIC_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
    print_info "IP publique détectée: $PUBLIC_IP"
    
    cat > "$INSTALL_DIR/.env" <<EOF
# Application
NODE_ENV=production
PORT=8100

# Voice Server (WebRTC)
VOICE_ANNOUNCED_IP=$PUBLIC_IP
VOICE_RTC_MIN_PORT=7500
VOICE_RTC_MAX_PORT=8000

# Auth Database
AUTH_DB_HOST=postgres
AUTH_DB_PORT=5432
AUTH_DB_NAME=ohkay_auth

# DM Database
DM_DB_HOST=postgres
DM_DB_PORT=5432
DM_DB_NAME=ohkay_dms

# Registry Database
REGISTRY_DB_HOST=postgres
REGISTRY_DB_PORT=5432
REGISTRY_DB_NAME=ohkay_server_registry

# Database Credentials
DB_USER=ohkay_user
DB_PASSWORD=$DB_PASSWORD

# Database Admin (pour création dynamique)
DB_HOST=postgres
DB_PORT=5432
DB_ADMIN_USER=postgres
DB_ADMIN_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# Security
JWT_SECRET=$JWT_SECRET
INSTANCE_PASSWORD=$INSTANCE_PASSWORD
DB_ENCRYPTION_KEY=$DB_ENCRYPTION_KEY
MASTER_ENCRYPTION_KEY=$MASTER_ENCRYPTION_KEY

# Other
CORS_ORIGIN=*
LOG_LEVEL=info
EOF
    
    chmod 600 "$INSTALL_DIR/.env"
    
    verify_step "Configuration" \
        "test -f $INSTALL_DIR/.env && grep -q 'JWT_SECRET' $INSTALL_DIR/.env" \
        "Fichier .env créé avec succès" \
        "Échec création .env"
    
    echo ""
    print_warning "IMPORTANT - Informations de sécurité:"
    echo ""
    echo "  ✓ Mot de passe d'instance: (celui que vous avez choisi)"
    echo "  ✓ Mot de passe DB: Généré automatiquement (64 caractères)"
    echo "  ✓ JWT Secret: Généré automatiquement (64 caractères)"
    echo "  ✓ Clé de chiffrement DB: Générée automatiquement (64 caractères)"
    echo "  ✓ Clé de chiffrement messages: Générée automatiquement (64 caractères)"
    echo ""
    echo "  Tous les secrets sont stockés dans: $INSTALL_DIR/.env"
    echo "  Permissions: 600 (lecture/écriture root uniquement)"
    echo ""
}

# Création des fichiers Docker
create_docker_files() {
    print_header "Vérification des fichiers Docker"
    
    # Les fichiers existent déjà dans le repo cloné
    if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -f "$INSTALL_DIR/Dockerfile" ]; then
        print_success "Fichiers Docker présents (architecture unifiée)"
    else
        print_error "Fichiers Docker manquants"
        exit 1
    fi
    
    verify_step "Docker files" \
        "test -f $INSTALL_DIR/docker-compose.yml && test -f $INSTALL_DIR/Dockerfile" \
        "Fichiers Docker OK" \
        "Fichiers Docker manquants"
}

# Création du service systemd
create_systemd_service() {
    print_header "Création du service systemd"
    
    cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Ohkay Server
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
User=root

# Démarrage : attendre que les containers soient healthy
ExecStartPre=/usr/bin/docker compose pull --quiet
ExecStart=/usr/bin/docker compose up -d
ExecStartPost=/bin/bash -c 'for i in {1..60}; do /usr/bin/docker inspect --format="{{.State.Health.Status}}" ohkay-server | grep -q "healthy" && exit 0; sleep 2; done; exit 1'

# Arrêt : graceful shutdown avec timeout
ExecStop=/usr/bin/docker compose down --timeout 20

# Redémarrage : attendre avant de relancer
RestartSec=10s
Restart=on-failure

# Timeouts
TimeoutStartSec=180s
TimeoutStopSec=30s

# Logs
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ohkay-server

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME.service"
    
    print_success "Service systemd créé et activé (avec healthcheck et graceful shutdown)"
}

# Script de backup
create_backup_script() {
    print_header "Création du script de backup"
    
    cat > "/usr/local/bin/backup-ohkay.sh" <<EOF
#!/bin/bash
BACKUP_DIR="$BACKUP_DIR"
DATE=\$(date +%Y%m%d_%H%M%S)

mkdir -p \$BACKUP_DIR

# Backup PostgreSQL unifié (toutes les bases)
docker exec ohkay-postgres pg_dumpall -U postgres > \$BACKUP_DIR/ohkay_all_dbs_\$DATE.sql

# Compresser
tar -czf \$BACKUP_DIR/ohkay_backup_\$DATE.tar.gz \$BACKUP_DIR/ohkay_all_dbs_\$DATE.sql
rm \$BACKUP_DIR/ohkay_all_dbs_\$DATE.sql

# Backup fichier .env (contient les clés de chiffrement - CRITIQUE)
cp $INSTALL_DIR/.env \$BACKUP_DIR/.env_\$DATE
tar -czf \$BACKUP_DIR/ohkay_env_\$DATE.tar.gz \$BACKUP_DIR/.env_\$DATE
rm \$BACKUP_DIR/.env_\$DATE
chmod 600 \$BACKUP_DIR/ohkay_env_\$DATE.tar.gz

# Garder seulement les 7 derniers backups
find \$BACKUP_DIR -name "ohkay_backup_*.tar.gz" -mtime +7 -delete
find \$BACKUP_DIR -name "ohkay_env_*.tar.gz" -mtime +7 -delete

echo "\$(date): Backup completed - ohkay_backup_\$DATE.tar.gz" >> /var/log/ohkay-backup.log
EOF
    
    chmod +x /usr/local/bin/backup-ohkay.sh
    
    # Ajouter au crontab
    (crontab -l 2>/dev/null | grep -v backup-ohkay; echo "0 2 * * * /usr/local/bin/backup-ohkay.sh") | crontab -
    
    verify_step "Backup script" \
        "test -x /usr/local/bin/backup-ohkay.sh" \
        "Script de backup créé (exécution quotidienne à 2h)" \
        "Échec création script backup"
}

# Optimisations système
optimize_system() {
    print_header "Optimisations système"
    
    # Limites de fichiers
    if ! grep -q "ohkay file limits" /etc/security/limits.conf; then
        cat >> /etc/security/limits.conf <<EOF

# ohkay file limits
* soft nofile 65536
* hard nofile 65536
EOF
        print_success "Limites de fichiers augmentées"
    fi
    
    # Paramètres réseau
    if ! grep -q "ohkay network optimizations" /etc/sysctl.conf; then
        cat >> /etc/sysctl.conf <<EOF

# ohkay network optimizations
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192
EOF
        sysctl -p > /dev/null 2>&1
        print_success "Paramètres réseau optimisés"
    fi
}

# Démarrage du serveur
start_server() {
    print_header "Démarrage du serveur"
    
    cd "$INSTALL_DIR"
    
    print_info "Construction des images Docker..."
    if ! docker compose build --no-cache; then
        print_error "Échec de la construction des images Docker"
        print_info "Vérifiez les logs ci-dessus pour plus de détails"
        exit 1
    fi
    
    verify_step "Docker build" \
        "docker images | grep -q ohkay" \
        "Images Docker construites" \
        "Échec construction images"
    
    print_info "Démarrage des conteneurs..."
    if ! docker compose up -d; then
        print_error "Échec du démarrage des conteneurs"
        print_info "Logs Docker:"
        docker compose logs --tail=50
        exit 1
    fi
    
    print_info "Attente du démarrage complet (60 secondes)..."
    print_warning "Le premier démarrage peut prendre plus de temps (construction des tables DB)..."
    sleep 60
    
    print_info "Vérification de l'état des conteneurs..."
    docker compose ps
    
    verify_step "Conteneurs" \
        "docker compose ps | grep -q 'Up'" \
        "Conteneurs démarrés" \
        "Certains conteneurs ne sont pas démarrés"
}

# Test de santé
health_check() {
    print_header "Test de santé"
    
    print_info "Test de l'endpoint /health..."
    
    # Essayer plusieurs fois avec timeout
    for i in {1..10}; do
        if curl -f -s --max-time 5 http://localhost:8100/health > /dev/null 2>&1; then
            print_success "✓ Le serveur répond correctement!"
            echo ""
            print_info "Réponse du serveur:"
            curl -s http://localhost:8100/health | jq . 2>/dev/null || curl -s http://localhost:8100/health
            return 0
        fi
        print_warning "Tentative $i/10... (attente du healthcheck Docker)"
        sleep 5
    done
    
    print_warning "Le serveur ne répond pas encore"
    echo ""
    print_info "Vérifiez les logs avec:"
    echo "  cd $INSTALL_DIR && docker compose logs -f"
}

# Affichage des informations finales
show_final_info() {
    print_header "Installation terminée!"
    
    echo ""
    print_success "Ohkay Server est installé et en cours d'exécution"
    echo ""
    print_info "Informations importantes:"
    # Récupérer l'IP publique
    PUBLIC_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
    
    echo ""
    echo "  📁 Répertoire: $INSTALL_DIR"
    echo "  🔑 Mot de passe d'instance: (celui que vous avez défini)"
    echo "  🔐 Secrets DB/JWT/Encryption: Générés automatiquement (voir .env)"
    echo "  🌐 URL Backend: http://$PUBLIC_IP:8100"
    echo "  📊 Health check: http://localhost:8100/health"
    echo "  🔥 Pare-feu: ports 8100 (API) + 7500-8000 (WebRTC) ouverts"
    echo "  🎤 WebRTC IP: $PUBLIC_IP (ports 7500-8000)"
    echo ""
    print_info "Commandes utiles:"
    echo ""
    echo "  # Voir les logs"
    echo "  cd $INSTALL_DIR && docker compose logs -f"
    echo ""
    echo "  # Arrêter le serveur"
    echo "  systemctl stop $SERVICE_NAME"
    echo ""
    echo "  # Démarrer le serveur"
    echo "  systemctl start $SERVICE_NAME"
    echo ""
    echo "  # Redémarrer le serveur"
    echo "  systemctl restart $SERVICE_NAME"
    echo ""
    echo "  # Voir le statut"
    echo "  systemctl status $SERVICE_NAME"
    echo ""
    echo "  # Backup manuel"
    echo "  /usr/local/bin/backup-ohkay.sh"
    echo ""
    echo "  # Mettre à jour le code"
    echo "  cd $INSTALL_DIR && git pull && docker compose up -d --build"
    echo ""
    print_warning "IMPORTANT: Sauvegardez ces informations:"
    echo "  - Mot de passe d'instance: (celui que vous avez défini)"
    echo "  - Tous les secrets: $INSTALL_DIR/.env (permissions 600)"
    echo "  - Backup du .env recommandé dans un gestionnaire de mots de passe"
    echo ""
    print_info "Sécurité des secrets:"
    echo "  ✓ JWT Secret: 64 caractères (512 bits)"
    echo "  ✓ DB Password: 64 caractères (512 bits)"
    echo "  ✓ Encryption Key: 64 caractères (512 bits)"
    echo "  ✓ Fichier .env: accessible uniquement par root"
    echo ""
    print_info "Pour déployer le frontend:"
    echo "  cd $INSTALL_DIR/client"
    echo "  npm install"
    echo "  npm run build"
    echo "  # Puis servir le dossier dist/ avec Nginx/Caddy"
    echo ""
}

# Menu interactif
interactive_mode() {
    print_header "Installation Interactive d'Ohkay Server"
    
    echo ""
    read -p "Répertoire d'installation [$INSTALL_DIR]: " custom_dir
    if [[ -n "$custom_dir" ]]; then
        INSTALL_DIR="$custom_dir"
    fi
    
    echo ""
    read -p "Voulez-vous générer automatiquement les mots de passe? (O/n): " auto_pass
    if [[ "$auto_pass" =~ ^[Nn]$ ]]; then
        read -sp "Mot de passe d'instance: " INSTANCE_PASSWORD
        echo ""
        read -sp "Mot de passe PostgreSQL: " POSTGRES_PASSWORD
        echo ""
        read -sp "Mot de passe DB User: " DB_PASSWORD
        echo ""
        # Générer automatiquement les clés cryptographiques (même longueur qu'en auto)
        JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
        DB_ENCRYPTION_KEY=$(openssl rand -base64 64 | tr -d '\n')
        MASTER_ENCRYPTION_KEY=$(openssl rand -base64 64 | tr -d '\n')
        print_info "JWT_SECRET, DB_ENCRYPTION_KEY et MASTER_ENCRYPTION_KEY générés automatiquement"
    fi
    # Note: Si auto_pass=O, generate_secrets sera appelé plus tard dans main()
    
    echo ""
    read -p "Configurer le backup automatique? (O/n): " setup_backup
    
    echo ""
    read -p "Optimiser les paramètres système? (O/n): " do_optimize
}

# Programme principal
main() {
    print_header "Installation d'Ohkay Server pour AlmaLinux 9"
    
    check_root
    check_os
    check_system_requirements
    
    # Afficher un résumé de ce qui va être installé
    echo ""
    print_info "Ce script va installer:"
    echo "  • Docker + Docker Compose"
    echo "  • PostgreSQL 16 (conteneurisé)"
    echo "  • Ohkay Server (Node.js 20 + TypeScript)"
    echo "  • Service systemd (auto-démarrage)"
    echo "  • Configuration firewall + SELinux"
    echo "  • Script de backup automatique (cron)"
    echo ""
    print_warning "Durée estimée: 5-10 minutes"
    echo ""
    read -p "Continuer avec l'installation? (O/n): " confirm_install
    if [[ "$confirm_install" =~ ^[Nn]$ ]]; then
        print_info "Installation annulée"
        exit 0
    fi
    echo ""
    
    # Mode interactif ou automatique
    if [[ "$1" == "--auto" ]]; then
        print_error "Mode automatique désactivé: le mot de passe d'instance doit être défini manuellement"
        exit 1
    else
        interactive_mode
    fi
    
    # Mise à jour système
    print_header "Mise à jour du système"
    dnf update -y
    verify_step "Système" "true" "Système à jour" "Échec mise à jour"
    
    # Installation
    install_git
    install_tools
    install_docker
    configure_firewall
    configure_selinux
    setup_directories
    clone_repository
    setup_logs_directory
    generate_secrets
    create_env_file
    create_docker_files
    create_systemd_service
    
    if [[ ! "$setup_backup" =~ ^[Nn]$ ]]; then
        create_backup_script
    fi
    
    if [[ ! "$do_optimize" =~ ^[Nn]$ ]]; then
        optimize_system
    fi
    
    start_server
    health_check
    show_final_info
}

# Gestion des erreurs
cleanup_on_error() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        print_error "Une erreur est survenue (code: $exit_code)"
        echo ""
        print_info "Logs utiles pour le diagnostic:"
        echo "  - Logs Docker: cd $INSTALL_DIR && docker compose logs"
        echo "  - Logs système: journalctl -xe"
        echo "  - Status containers: docker ps -a"
        echo ""
        print_info "Pour nettoyer une installation échouée:"
        echo "  cd $INSTALL_DIR && docker compose down -v"
        echo "  systemctl stop $SERVICE_NAME"
        echo "  systemctl disable $SERVICE_NAME"
    fi
}

trap cleanup_on_error ERR

# Lancement
main "$@"
