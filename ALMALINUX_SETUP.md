# 🐧 Installation sur AlmaLinux 9

Guide complet pour déployer Ohkay Server sur AlmaLinux 9.

## 📋 Prérequis système

- AlmaLinux 9 (minimal ou avec GUI)
- Accès root ou sudo
- Au moins 2GB de RAM
- 10GB d'espace disque disponible

## 🔧 Installation des dépendances

### 1. Mettre à jour le système

```bash
sudo dnf update -y
```

### 2. Installer les outils de base

```bash
sudo dnf install -y git curl wget nano
```

### 3. Installer Docker

```bash
# Installer les dépendances Docker
sudo dnf install -y dnf-plugins-core

# Ajouter le repository Docker officiel
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# Installer Docker Engine
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Démarrer et activer Docker
sudo systemctl start docker
sudo systemctl enable docker

# Vérifier l'installation
sudo docker --version
sudo docker compose version
```

### 4. Ajouter votre utilisateur au groupe Docker (optionnel mais recommandé)

```bash
sudo usermod -aG docker $USER

# Recharger les groupes (ou se déconnecter/reconnecter)
newgrp docker

# Tester sans sudo
docker ps
```

### 5. Installer Node.js (pour le développement local, optionnel)

```bash
# Installer Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# Vérifier l'installation
node --version
npm --version
```

## 🚀 Déploiement de Ohkay Server

### 1. Cloner le repository

```bash
cd /opt
sudo git clone <votre-repo-url> ohkay-server
cd ohkay-server
sudo chown -R $USER:$USER /opt/ohkay-server
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env
nano .env
```

Configurez les valeurs suivantes (IMPORTANT - changez tout) :

```env
PORT=3000
NODE_ENV=production

DB_NAME=ohkay
DB_USER=ohkay_user
DB_PASSWORD=VotreMdpSecurisePourPostgreSQL123!

JWT_SECRET=$(openssl rand -base64 32)
SERVER_PASSWORD=MotDePasseServeurSecurise456!

LOG_LEVEL=info
LOG_DIR=./logs
```

💡 **Astuce** : Générer des secrets sécurisés :
```bash
# Pour JWT_SECRET
openssl rand -base64 32

# Pour les mots de passe
openssl rand -base64 24
```

### 3. Configurer le pare-feu (firewalld)

```bash
# Vérifier si firewalld est actif
sudo systemctl status firewalld

# Ouvrir le port 3000 pour Ohkay
sudo firewall-cmd --permanent --add-port=3000/tcp

# Ouvrir le port 5432 si vous voulez accéder à PostgreSQL depuis l'extérieur (non recommandé en production)
# sudo firewall-cmd --permanent --add-port=5432/tcp

# Recharger le pare-feu
sudo firewall-cmd --reload

# Vérifier les ports ouverts
sudo firewall-cmd --list-ports
```

### 4. Configurer SELinux (si activé)

```bash
# Vérifier le statut de SELinux
getenforce

# Si SELinux est en mode Enforcing, configurer les permissions pour Docker
sudo setsebool -P container_manage_cgroup on

# Autoriser Docker à gérer les volumes
sudo chcon -Rt svirt_sandbox_file_t /opt/ohkay-server/logs
```

**Alternative** : Si vous rencontrez des problèmes avec SELinux (non recommandé en production) :
```bash
# Passer en mode permissive (temporaire)
sudo setenforce 0

# Ou désactiver définitivement (éditer /etc/selinux/config)
sudo nano /etc/selinux/config
# Changer SELINUX=enforcing en SELINUX=permissive
```

### 5. Créer les répertoires nécessaires

```bash
mkdir -p logs
chmod 755 logs
```

### 6. Construire et démarrer les conteneurs

```bash
# Construire l'image Docker
docker compose build

# Démarrer les services
docker compose up -d

# Vérifier que les conteneurs tournent
docker compose ps

# Afficher les logs
docker compose logs -f
```

### 7. Vérifier le déploiement

```bash
# Test local
curl http://localhost:3000/health

# Test depuis une autre machine (remplacez <IP-SERVEUR>)
curl http://<IP-SERVEUR>:3000/health
```

Réponse attendue :
```json
{"status":"ok","timestamp":"2025-10-22T..."}
```

## 🔄 Gestion du service

### Commandes Docker Compose

```bash
# Voir les logs en temps réel
docker compose logs -f

# Voir uniquement les logs de l'application
docker compose logs -f app

# Voir uniquement les logs de PostgreSQL
docker compose logs -f postgres

# Arrêter les services
docker compose down

# Redémarrer les services
docker compose restart

# Reconstruire et redémarrer
docker compose down
docker compose build
docker compose up -d
```

### Gestion des logs applicatifs

```bash
# Voir les logs de l'application
tail -f logs/application-$(date +%Y-%m-%d).log

# Voir les logs d'erreur
tail -f logs/error-$(date +%Y-%m-%d).log

# Rechercher des erreurs récentes
grep -i error logs/application-*.log | tail -20
```

## 🔧 Configuration de systemd (démarrage automatique)

Créer un service systemd pour démarrer automatiquement au boot :

```bash
sudo nano /etc/systemd/system/ohkay-server.service
```

Contenu du fichier :

```ini
[Unit]
Description=Ohkay Server
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/ohkay-server
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=root

[Install]
WantedBy=multi-user.target
```

Activer et démarrer le service :

```bash
# Recharger systemd
sudo systemctl daemon-reload

# Activer le démarrage automatique
sudo systemctl enable ohkay-server.service

# Démarrer le service
sudo systemctl start ohkay-server.service

# Vérifier le statut
sudo systemctl status ohkay-server.service
```

## 🔒 Sécurité recommandée pour la production

### 1. Configurer un reverse proxy avec Nginx + SSL

```bash
# Installer Nginx
sudo dnf install -y nginx certbot python3-certbot-nginx

# Créer la configuration Nginx
sudo nano /etc/nginx/conf.d/ohkay.conf
```

Configuration Nginx :

```nginx
upstream ohkay_backend {
    server localhost:3000;
}

server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://ohkay_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Tester la configuration
sudo nginx -t

# Démarrer Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Configurer le pare-feu pour HTTP/HTTPS
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

# Obtenir un certificat SSL gratuit avec Let's Encrypt
sudo certbot --nginx -d votre-domaine.com
```

### 2. Limiter les connexions SSH

```bash
sudo nano /etc/ssh/sshd_config
```

Recommandations :
- Désactiver root login : `PermitRootLogin no`
- Changer le port SSH par défaut
- Utiliser l'authentification par clé

### 3. Installer fail2ban

```bash
sudo dnf install -y epel-release
sudo dnf install -y fail2ban

sudo systemctl start fail2ban
sudo systemctl enable fail2ban
```

## 📊 Monitoring et maintenance

### Monitoring des ressources

```bash
# Voir l'utilisation des ressources par les conteneurs
docker stats

# Voir l'espace disque utilisé par Docker
docker system df

# Nettoyer les images/conteneurs inutilisés
docker system prune -a
```

### Backup de la base de données

```bash
# Créer un script de backup
sudo nano /opt/backup-ohkay.sh
```

Contenu du script :

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/ohkay"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup PostgreSQL
docker exec ohkay-postgres pg_dump -U ohkay_user ohkay > $BACKUP_DIR/ohkay_db_$DATE.sql

# Compresser
gzip $BACKUP_DIR/ohkay_db_$DATE.sql

# Garder seulement les 7 derniers backups
find $BACKUP_DIR -name "ohkay_db_*.sql.gz" -mtime +7 -delete

echo "Backup completed: ohkay_db_$DATE.sql.gz"
```

```bash
# Rendre le script exécutable
sudo chmod +x /opt/backup-ohkay.sh

# Ajouter une tâche cron (backup quotidien à 2h du matin)
sudo crontab -e
```

Ajouter :
```
0 2 * * * /opt/backup-ohkay.sh >> /var/log/ohkay-backup.log 2>&1
```

### Restaurer un backup

```bash
# Restaurer la base de données
gunzip -c /opt/backups/ohkay/ohkay_db_YYYYMMDD_HHMMSS.sql.gz | \
  docker exec -i ohkay-postgres psql -U ohkay_user -d ohkay
```

## 🐛 Troubleshooting AlmaLinux

### Problème : Permission denied avec Docker

```bash
sudo chmod 666 /var/run/docker.sock
# Ou ajouter l'utilisateur au groupe docker (voir étape 4)
```

### Problème : Port déjà utilisé

```bash
# Vérifier quel processus utilise le port 3000
sudo ss -tulpn | grep :3000

# Si besoin, tuer le processus
sudo kill -9 <PID>
```

### Problème : SELinux bloque Docker

```bash
# Vérifier les logs SELinux
sudo ausearch -m avc -ts recent

# Voir les suggestions de correction
sudo ausearch -m avc -ts recent | audit2why
```

### Problème : Les conteneurs ne démarrent pas

```bash
# Vérifier les logs Docker
sudo journalctl -u docker -n 50

# Vérifier les logs des conteneurs
docker compose logs

# Redémarrer Docker
sudo systemctl restart docker
```

### Problème : Connexion à la base de données échoue

```bash
# Vérifier que PostgreSQL est accessible
docker exec -it ohkay-postgres psql -U ohkay_user -d ohkay

# Si ça fonctionne, vérifier les variables d'environnement de l'app
docker compose config
```

## 📈 Optimisations pour la production

### 1. Augmenter les limites de fichiers ouverts

```bash
sudo nano /etc/security/limits.conf
```

Ajouter :
```
* soft nofile 65536
* hard nofile 65536
```

### 2. Optimiser les paramètres réseau

```bash
sudo nano /etc/sysctl.conf
```

Ajouter :
```
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192
```

Appliquer :
```bash
sudo sysctl -p
```

### 3. Configurer la rotation des logs Docker

```bash
sudo nano /etc/docker/daemon.json
```

Ajouter :
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Redémarrer Docker :
```bash
sudo systemctl restart docker
```

## 🎯 Checklist de déploiement

- [ ] AlmaLinux 9 à jour
- [ ] Docker et Docker Compose installés
- [ ] Variables d'environnement configurées avec des valeurs sécurisées
- [ ] Pare-feu configuré (port 3000 ouvert)
- [ ] SELinux configuré ou en mode permissive
- [ ] Conteneurs démarrés avec succès
- [ ] Health check répond correctement
- [ ] Nginx + SSL configuré (pour production)
- [ ] Service systemd créé et activé
- [ ] Backup automatique configuré
- [ ] Monitoring en place

## 📞 Support

Pour les problèmes spécifiques à AlmaLinux 9, consultez :
- Documentation AlmaLinux : https://wiki.almalinux.org/
- Forum Docker : https://forums.docker.com/
- Issues GitHub du projet

---

✅ Votre serveur Ohkay est maintenant prêt pour la production sur AlmaLinux 9 !
