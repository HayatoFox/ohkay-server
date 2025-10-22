µ# Script de test API Ohkay Server
# Usage: .\test-api.ps1

$BASE_URL = "http://localhost:3000"
$SERVER_PASSWORD = "test123"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "OHKAY SERVER - TESTS API" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Health Check
Write-Host "1. Test Health Check..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/health" -Method Get
    Write-Host "   [OK] Serveur operationnel: $($response.status)" -ForegroundColor Green
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 2: Inscription
Write-Host "`n2. Test Inscription utilisateur..." -ForegroundColor Yellow
$username = "testuser_$(Get-Random -Maximum 10000)"
$body = @{
    username = $username
    password = "password123"
    serverPassword = $SERVER_PASSWORD
    displayName = "Test User"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/auth/register" `
        -Method Post `
        -Body $body `
        -ContentType "application/json"
    $token = $response.token
    $userId = $response.user.id
    Write-Host "   [OK] Utilisateur cree: $username (ID: $userId)" -ForegroundColor Green
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 3: Connexion
Write-Host "`n3. Test Connexion..." -ForegroundColor Yellow
$loginBody = @{
    username = $username
    password = "password123"
    serverPassword = $SERVER_PASSWORD
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/auth/login" `
        -Method Post `
        -Body $loginBody `
        -ContentType "application/json"
    Write-Host "   [OK] Connexion reussie" -ForegroundColor Green
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Creer un serveur
Write-Host "`n4. Test Creation serveur..." -ForegroundColor Yellow
$serverBody = @{
    name = "Mon Premier Serveur"
    description = "Serveur de test"
} | ConvertTo-Json

try {
    $headers = @{
        Authorization = "Bearer $token"
        "Content-Type" = "application/json"
    }
    
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/servers" `
        -Method Post `
        -Body $serverBody `
        -Headers $headers
    $serverId = $response.server.id
    $inviteCode = $response.server.invite_code
    Write-Host "   [OK] Serveur cree: $($response.server.name) (ID: $serverId)" -ForegroundColor Green
    Write-Host "   Code d'invitation: $inviteCode" -ForegroundColor Cyan
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 5: Liste des serveurs
Write-Host "`n5. Test Liste des serveurs..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/servers" `
        -Method Get `
        -Headers $headers
    Write-Host "   [OK] Nombre de serveurs: $($response.servers.Count)" -ForegroundColor Green
    foreach ($server in $response.servers) {
        Write-Host "      - $($server.name) (Owner: $($server.owner_username))" -ForegroundColor Gray
    }
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Channels du serveur
Write-Host "`n6. Test Channels du serveur..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/servers/$serverId/channels" `
        -Method Get `
        -Headers $headers
    Write-Host "   [OK] Nombre de channels: $($response.channels.Count)" -ForegroundColor Green
    foreach ($channel in $response.channels) {
        Write-Host "      - #$($channel.name) (Type: $($channel.type))" -ForegroundColor Gray
    }
    
    if ($response.channels.Count -gt 0) {
        $channelId = $response.channels[0].id
    }
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
}

# Test 7: Creer un nouveau channel
Write-Host "`n7. Test Creation channel..." -ForegroundColor Yellow
$channelBody = @{
    serverId = $serverId
    name = "random"
    description = "Channel pour discussions aleatoires"
    type = "text"
    position = 1
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/channels" `
        -Method Post `
        -Body $channelBody `
        -Headers $headers
    Write-Host "   [OK] Channel cree: #$($response.channel.name)" -ForegroundColor Green
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
}

# Test 8: Membres du serveur
Write-Host "`n8. Test Membres du serveur..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/servers/$serverId/members" `
        -Method Get `
        -Headers $headers
    Write-Host "   [OK] Nombre de membres: $($response.members.Count)" -ForegroundColor Green
    foreach ($member in $response.members) {
        Write-Host "      - @$($member.username) ($($member.display_name))" -ForegroundColor Gray
    }
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
}

# Test 9: Creer une invitation
Write-Host "`n9. Test Creation invitation..." -ForegroundColor Yellow
$inviteBody = @{
    maxUses = 10
    expiresInHours = 24
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/servers/$serverId/invites" `
        -Method Post `
        -Body $inviteBody `
        -Headers $headers
    Write-Host "   [OK] Invitation creee: $($response.invite.code)" -ForegroundColor Green
    Write-Host "      Max utilisations: $($response.invite.max_uses)" -ForegroundColor Gray
    Write-Host "      Expire: $($response.invite.expires_at)" -ForegroundColor Gray
} catch {
    Write-Host "   [ERREUR] $($_.Exception.Message)" -ForegroundColor Red
}

# Resume
Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "RESUME DES TESTS" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Utilisateur: $username" -ForegroundColor White
Write-Host "Token JWT: $($token.Substring(0,20))..." -ForegroundColor White
Write-Host "Serveur ID: $serverId" -ForegroundColor White
Write-Host "Code d'invitation: $inviteCode" -ForegroundColor White
Write-Host ""
Write-Host "[OK] Tests termines avec succes!" -ForegroundColor Green
