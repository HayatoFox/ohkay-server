#!/bin/bash
# Script pour réinitialiser PostgreSQL proprement

echo "🔧 Resetting Ohkay PostgreSQL..."

# 1. Arrêter les conteneurs
echo "⏹️ Stopping containers..."
docker-compose down

# 2. Supprimer le volume PostgreSQL
echo "🗑️ Removing old PostgreSQL volume..."
docker volume rm ohkay-server_postgres-data

# 3. Redémarrer
echo "🚀 Starting fresh..."
docker-compose up -d

# 4. Suivre les logs
echo "📋 Following logs (Ctrl+C to exit)..."
docker-compose logs -f
