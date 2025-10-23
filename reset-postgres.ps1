# Script PowerShell pour réinitialiser PostgreSQL proprement

Write-Host "🔧 Resetting Ohkay PostgreSQL..." -ForegroundColor Cyan

# 1. Arrêter les conteneurs
Write-Host "⏹️ Stopping containers..." -ForegroundColor Yellow
docker-compose down

# 2. Supprimer le volume PostgreSQL
Write-Host "🗑️ Removing old PostgreSQL volume..." -ForegroundColor Yellow
docker volume rm ohkay-server_postgres-data

# 3. Redémarrer
Write-Host "🚀 Starting fresh..." -ForegroundColor Green
docker-compose up -d

# 4. Attendre un peu
Start-Sleep -Seconds 5

# 5. Suivre les logs
Write-Host "📋 Following logs (Ctrl+C to exit)..." -ForegroundColor Cyan
docker-compose logs -f
