#!/bin/bash
#############################################################################
# Ohkay Server - Script d'installation automatique pour AlmaLinux 9
# Usage: sudo bash install-almalinux.sh
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

# Installation de Docker
install_docker() {
    print_header "Installation de Docker"
    
    if command -v docker &> /dev/null; then
        print_warning "Docker est déjà installé"
        docker --version
    else
        print_info "Installation des dépendances..."
        dnf install -y dnf-plugins-core
        
        print_info "Ajout du repository Docker..."
        dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        
        print_info "Installation de Docker Engine..."
        dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        
        print_info "Démarrage de Docker..."
        systemctl start docker
        systemctl enable docker
        
        print_success "Docker installé avec succès"
        docker --version
    fi
}

# Configuration du pare-feu
configure_firewall() {
    print_header "Configuration du pare-feu"
    
    if systemctl is-active --quiet firewalld; then
        print_info "Ouverture du port 3000..."
        firewall-cmd --permanent --add-port=3000/tcp
        firewall-cmd --reload
        print_success "Pare-feu configuré (port 3000 ouvert)"
    else
        print_warning "firewalld n'est pas actif"
    fi
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
            print_success "SELinux configuré"
        fi
    fi
}

# Création de l'utilisateur et des répertoires
setup_directories() {
    print_header "Configuration des répertoires"
    
    print_info "Création du répertoire d'installation..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/logs"
    mkdir -p "$BACKUP_DIR"
    
    print_info "Configuration des permissions..."
    chmod 755 "$INSTALL_DIR"
    chmod 755 "$INSTALL_DIR/logs"
    
    print_success "Répertoires créés"
}

# Génération des secrets
generate_secrets() {
    print_header "Génération des secrets"
    
    JWT_SECRET=$(openssl rand -base64 32)
    DB_PASSWORD=$(openssl rand -base64 24)
    SERVER_PASSWORD=$(openssl rand -base64 16)
    
    print_success "Secrets générés"
}

# Création du fichier .env
create_env_file() {
    print_header "Création du fichier de configuration"
    
    cat > "$INSTALL_DIR/.env" <<EOF
# Server Configuration
PORT=3000
NODE_ENV=production

# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=ohkay
DB_USER=ohkay_user
DB_PASSWORD=$DB_PASSWORD

# Security
JWT_SECRET=$JWT_SECRET
SERVER_PASSWORD=$SERVER_PASSWORD

# Logging
LOG_LEVEL=info
LOG_DIR=./logs
EOF
    
    chmod 600 "$INSTALL_DIR/.env"
    print_success "Fichier .env créé"
    
    print_warning "IMPORTANT - Notez ces informations:"
    echo ""
    echo "  Mot de passe serveur: $SERVER_PASSWORD"
    echo "  Mot de passe DB: $DB_PASSWORD"
    echo ""
}

# Création des fichiers Docker
create_docker_files() {
    print_header "Création des fichiers Docker"
    
    # Dockerfile
    cat > "$INSTALL_DIR/Dockerfile" <<'EOF'
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/logs && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
CMD ["node", "dist/index.js"]
EOF
    
    # docker-compose.yml
    cat > "$INSTALL_DIR/docker-compose.yml" <<'EOF'
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ohkay-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=${DB_NAME}
      - DB_USER=${DB_USER}
      - DB_PASSWORD=${DB_PASSWORD}
      - JWT_SECRET=${JWT_SECRET}
      - SERVER_PASSWORD=${SERVER_PASSWORD}
      - LOG_LEVEL=${LOG_LEVEL}
    volumes:
      - ./logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - ohkay-network
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  postgres:
    image: postgres:16-alpine
    container_name: ohkay-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=${DB_NAME}
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    networks:
      - ohkay-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

networks:
  ohkay-network:
    driver: bridge

volumes:
  postgres-data:
EOF
    
    # init.sql
    cat > "$INSTALL_DIR/init.sql" <<'EOF'
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_private BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    is_private BOOLEAN DEFAULT FALSE,
    recipient_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    edited_at TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_members (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    socket_id VARCHAR(100) UNIQUE NOT NULL,
    ip_address VARCHAR(45),
    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(recipient_id) WHERE is_private = TRUE;
CREATE INDEX IF NOT EXISTS idx_channel_members ON channel_members(channel_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

INSERT INTO channels (name, description, is_private, created_at)
VALUES ('general', 'General discussion channel', FALSE, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
EOF
    
    print_success "Fichiers Docker créés"
}

# Création du service systemd
create_systemd_service() {
    print_header "Création du service systemd"
    
    cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Ohkay Server
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=root

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME.service"
    
    print_success "Service systemd créé et activé"
}

# Script de backup
create_backup_script() {
    print_header "Création du script de backup"
    
    cat > "/usr/local/bin/backup-ohkay.sh" <<EOF
#!/bin/bash
BACKUP_DIR="$BACKUP_DIR"
DATE=\$(date +%Y%m%d_%H%M%S)

mkdir -p \$BACKUP_DIR

# Backup PostgreSQL
docker exec ohkay-postgres pg_dump -U ohkay_user ohkay > \$BACKUP_DIR/ohkay_db_\$DATE.sql

# Compresser
gzip \$BACKUP_DIR/ohkay_db_\$DATE.sql

# Garder seulement les 7 derniers backups
find \$BACKUP_DIR -name "ohkay_db_*.sql.gz" -mtime +7 -delete

echo "\$(date): Backup completed - ohkay_db_\$DATE.sql.gz" >> /var/log/ohkay-backup.log
EOF
    
    chmod +x /usr/local/bin/backup-ohkay.sh
    
    # Ajouter au crontab
    (crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-ohkay.sh") | crontab -
    
    print_success "Script de backup créé (exécution quotidienne à 2h)"
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
    docker compose build
    
    print_info "Démarrage des conteneurs..."
    docker compose up -d
    
    print_info "Attente du démarrage (30 secondes)..."
    sleep 30
    
    print_info "Vérification de l'état..."
    docker compose ps
    
    print_success "Serveur démarré"
}

# Test de santé
health_check() {
    print_header "Test de santé"
    
    print_info "Test de l'endpoint /health..."
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        print_success "Le serveur répond correctement!"
    else
        print_warning "Le serveur ne répond pas encore, vérifiez les logs:"
        echo "  docker compose logs -f"
    fi
}

# Affichage des informations finales
show_final_info() {
    print_header "Installation terminée!"
    
    echo ""
    print_success "Ohkay Server est installé et en cours d'exécution"
    echo ""
    print_info "Informations importantes:"
    echo ""
    echo "  📁 Répertoire: $INSTALL_DIR"
    echo "  🔑 Mot de passe serveur: $SERVER_PASSWORD"
    echo "  🔑 Mot de passe DB: $DB_PASSWORD"
    echo "  🌐 URL: http://$(hostname -I | awk '{print $1}'):3000"
    echo "  📊 Health check: http://localhost:3000/health"
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
    print_warning "IMPORTANT: Sauvegardez les mots de passe affichés ci-dessus!"
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
        read -sp "Mot de passe du serveur: " SERVER_PASSWORD
        echo ""
        read -sp "Mot de passe PostgreSQL: " DB_PASSWORD
        echo ""
        JWT_SECRET=$(openssl rand -base64 32)
    else
        generate_secrets
    fi
    
    echo ""
    read -p "Configurer le backup automatique? (O/n): " setup_backup
    
    echo ""
    read -p "Optimiser les paramètres système? (O/n): " do_optimize
}

# Programme principal
main() {
    print_header "Installation d'Ohkay Server pour AlmaLinux 9"
    
    check_root
    
    # Mode interactif ou automatique
    if [[ "$1" == "--auto" ]]; then
        print_info "Mode automatique"
        generate_secrets
        setup_backup="O"
        do_optimize="O"
    else
        interactive_mode
    fi
    
    # Mise à jour système
    print_header "Mise à jour du système"
    dnf update -y
    print_success "Système à jour"
    
    # Installation
    install_docker
    configure_firewall
    configure_selinux
    setup_directories
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
trap 'print_error "Une erreur est survenue. Vérifiez les logs."; exit 1' ERR

# Lancement
main "$@"
