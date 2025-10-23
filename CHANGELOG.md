# 📝 Changelog - Ohkay

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

## [1.4.0] - 2025-10-23

### ✨ Ajouté - Serveur

- **Système de Hiérarchie de Rôles Complet** 👑
  - **getHighestRole()**: Récupère le rôle avec la position la plus élevée d'un utilisateur
    - Owner retourne position `Number.MAX_SAFE_INTEGER` (position infinie virtuelle)
    - Query optimisée avec `ORDER BY position DESC LIMIT 1`
  
  - **canManageRole()**: Vérification hiérarchique pour gestion des rôles
    - Owner bypass toutes les vérifications
    - Requiert MANAGE_ROLES ou ADMINISTRATOR
    - **Hiérarchie stricte**: highest role actor > target role position
    - Protection ADMINISTRATOR: ne peut gérer role admin que si on a admin soi-même
    - Retourne `{allowed: boolean, reason?: string}`
  
  - **canModerateUser()**: Vérification hiérarchique pour modération (kick/ban)
    - Cannot moderate yourself (auto-protection)
    - **Owner intouchable**: Cannot moderate server owner
    - Owner peut modérer n'importe qui (bypass)
    - Requiert permission appropriée (KICK_MEMBERS ou BAN_MEMBERS)
    - **Hiérarchie stricte**: highest role actor > highest role target
    - Protection ADMINISTRATOR: ne peut modérer admin que si on a admin
    - Retourne `{allowed: boolean, reason?: string}`

- **Intégration Hiérarchie dans Routes**
  - `PATCH /api/roles/:serverId/roles/:roleId`: Vérifie hiérarchie avant modification rôle
  - `DELETE /api/roles/:serverId/roles/:roleId`: Vérifie hiérarchie avant suppression rôle
  - `POST /api/roles/:serverId/members/:memberId/roles/:roleId`: Vérifie hiérarchie avant attribution
  - `DELETE /api/roles/:serverId/members/:memberId/roles/:roleId`: Vérifie hiérarchie avant retrait
  - `POST /api/moderation/:serverId/members/:memberId/kick`: Vérifie hiérarchie avant kick
  - `POST /api/moderation/:serverId/bans/:memberId`: Vérifie hiérarchie avant ban
  - Protection owner maintenue partout (owner = intouchable)

- **Réorganisation des Rôles** 🔄
  - `PATCH /api/roles/:serverId/roles/reorder`: Réordonne plusieurs rôles en une transaction
  - Body: `{roleOrders: [{roleId: number, position: number}]}`
  - Vérifie MANAGE_ROLES pour l'acteur
  - Vérifie hiérarchie pour chaque rôle à déplacer (via canManageRole)
  - Transaction SQL (BEGIN/COMMIT/ROLLBACK) pour atomicité
  - Permet drag & drop dans l'UI

- **Liste Membres avec Tri par Rôle** 📊
  - `GET /api/members/:serverId/members?sortByRole=true`: Membres triés par highest role DESC
    - Récupère highest_role_id et highest_role_position pour chaque membre
    - Owner toujours en premier
    - Tri par position de rôle décroissante
    - Retourne `{members: [], totalCount: number}`
  
  - `GET /api/members/:serverId/members?groupByRole=true`: Membres groupés par rôle hoisted
    - Groupe "owner" en premier (si présent)
    - Groupes par rôles hoisted (is_hoisted=true) triés par position DESC
    - Groupe "noRole" pour membres sans rôle hoisted
    - Structure: `{owner: [], roles: [{role: {...}, members: []}], noRole: []}`
    - Parfait pour affichage Discord-like avec séparateurs de rôle

- **Fichier `routes/members.ts`** (133 lignes)
  - Route GET pour liste membres avec options de tri
  - Intégration avec getHighestRole() pour positions
  - Support tri simple et groupement par rôle hoisted
  - Enregistré dans index.ts sur `/api/members`

### 🔧 Modifié - Serveur

- **routes/roles.ts**: Intégration canManageRole dans toutes les routes de gestion
- **routes/moderation.ts**: Intégration canModerateUser dans kick/ban
- **routes/permissions.ts**: Ajout 3 helpers (getHighestRole, canManageRole, canModerateUser)
- **index.ts**: Enregistrement route `/api/members` avec memberRoutes

### 📈 Statistiques - Hiérarchie de Rôles

- **+200 lignes** de logique hiérarchique (3 helpers)
- **+133 lignes** route members avec tri
- **+70 lignes** route reorder
- **6 routes modifiées** avec vérifications hiérarchie
- **Total: ~400 lignes** de code hiérarchie

## [1.3.0] - 2025-10-23

### ✨ Ajouté - Client

- **Paramètres Utilisateur Complets** 🎛️
  - Modal Settings avec sidebar et tabs (Profil, Voix & Vidéo, Apparence, Notifications)
  - **Section Profil**:
    - Édition du nom d'affichage
    - Statut personnalisé avec emoji (128 caractères max)
    - Affichage avatar et informations utilisateur
  - **Section Voix & Vidéo**:
    - Sélection périphérique d'entrée (microphone) avec énumération automatique
    - Sélection périphérique de sortie (haut-parleurs) avec support setSinkId
    - Sliders de volume entrée/sortie (0-100%) appliqués en temps réel
    - **Test microphone** avec barre de niveau temps réel (vert→orange→rouge)
    - **Écoute du retour micro** (monitoring) avec toggle
    - **Test sortie audio** (beep 440Hz) avec volume ajusté
    - **Auto-mute**: Tests s'arrêtent automatiquement à la fermeture des paramètres
    - Options traitement audio (echo cancellation, noise suppression, auto gain control)
  - Persistence automatique dans localStorage
  - Cleanup automatique des streams audio/micro
  - Bouton ⚙️ dans MainLayout pour ouvrir les paramètres

- **Service Audio Settings** (`audioSettings.ts` - 281 lignes)
  - Énumération des périphériques audio (input/output)
  - Test audio avec AudioContext + OscillatorNode (440Hz sine wave)
  - Test microphone avec AnalyserNode pour détection niveau (FFT 512)
  - Monitoring microphone (connexion au destination pour écoute retour)
  - Application volumes en temps réel via GainNode
  - Cleanup automatique de toutes les ressources

- **Store Settings** (`settingsStore.ts` - 246 lignes)
  - Gestion état complet des paramètres (profile, voice, appearance, notifications)
  - AudioDevice interface (deviceId, label, kind)
  - VoiceSettings (devices, volumes, processing options, VAD, PTT)
  - AppearanceSettings (theme, compact mode, font size, timestamps)
  - NotificationSettings (sounds, desktop/push notifications, mute)
  - Actions pour tests audio (isTestingAudio, isTestingMicrophone, isMicrophoneMonitoring)
  - Persistence localStorage (loadSettings/saveSettings)

### 📚 Documentation - Client

- `USER_SETTINGS_IMPLEMENTATION.md`: Guide complet des paramètres utilisateur
- `CLIENT_VOICE_IMPLEMENTATION.md`: Documentation système vocal client
- `VOICE_CLIENT_COMPLETE.md`: Récapitulatif implémentation vocale complète

## [1.2.0] - 2025-10-23

### ✨ Ajouté - Client

- **Système Vocal WebRTC Complet** 🎤
  - Service vocal (`voice.ts` - 474 lignes) avec mediasoup-client
  - Gestion Device mediasoup pour codecs WebRTC
  - Création transports send/recv avec DTLS
  - Production audio local (getUserMedia avec echo cancellation, noise suppression, auto gain)
  - Consommation audio distant (consumers par peer avec audio elements)
  - **Voice Activity Detection** temps réel via AudioContext + AnalyserNode
  - Auto-cleanup complet des ressources (transports, consumers, streams)

- **WebSocket Events Vocaux**
  - Listeners pour: `voice:peer-joined`, `voice:peer-left`, `voice:new-producer`
  - Listeners pour: `voice:peer-muted`, `voice:peer-deafened`, `voice:peer-speaking`
  - Émission: `voice:join`, `voice:leave`, `voice:produce`, `voice:consume`
  - Émission: `voice:mute`, `voice:deafen`
  - Méthodes génériques `emit()`, `on()`, `off()` dans websocketService

- **Store Vocal** (`voiceStore.ts` - 127 lignes)
  - VoicePeer interface (userId, username, isMuted, isDeafened, isSpeaking, audioElement)
  - État connexion (isConnected, isConnecting, currentVoiceChannelId)
  - État local (isMuted, isDeafened, isSpeaking)
  - Map des peers avec audio elements
  - Actions complètes (addPeer, removePeer, updatePeer, clearPeers)
  - Cleanup automatique des audio elements

- **Composant VoiceControls** (174 lignes + 259 lignes CSS)
  - UI complète avec boutons join/leave
  - Boutons mute/deafen avec états actifs (rouge)
  - Liste des peers avec avatars et initiales
  - Status icons (🔇 muted, 🔕 deafened, 🔊 speaking)
  - Speaking indicator animé avec border verte
  - Connection status avec indicateur "• Connected"
  - Gestion erreurs avec affichage utilisateur
  - Auto-join au mount, auto-leave au unmount

- **Intégration ChannelList**
  - Affichage channels vocaux avec icône 🔊
  - Click handler pour sélection channel vocal
  - Affichage VoiceControls conditionnel
  - Active state pour channel vocal actuel

- **API Endpoints Vocaux**
  - `getRtpCapabilities(serverId, channelId)`: Récupérer RTP capabilities du router
  - `createTransport(serverId, channelId, direction)`: Créer transport send/recv
  - `connectTransport(serverId, channelId, transportId, dtlsParameters)`: Connecter transport

### ✨ Ajouté - Serveur

- **Système Vocal Mediasoup SFU** 🔊
  - Worker mediasoup avec configuration optimisée (ports 7500-8000, 501 ports = ~250 connexions)
  - Router par channel vocal avec codecs Opus/VP8/VP9/H264
  - Transports WebRTC (send/recv) par utilisateur
  - Producers/Consumers avec gestion automatique
  - Broadcasting des nouveaux producers à tous les peers
  - Cleanup automatique des ressources (transports, producers, consumers)

- **WebSocket Events Vocaux Serveur**
  - `voice:join`: Rejoindre channel vocal
  - `voice:leave`: Quitter channel vocal
  - `voice:produce`: Créer producer
  - `voice:consume`: Consommer producer peer
  - `voice:mute`, `voice:deafen`: États utilisateur
  - Broadcasting: `voice:peer-joined`, `voice:peer-left`, `voice:new-producer`

- **Routes Voice** (`/api/servers/:id/channels/:id/voice/*`)
  - `GET /rtp-capabilities`: Récupérer RTP capabilities du router
  - `POST /transports`: Créer transport send ou recv
  - `POST /transports/:id/connect`: Connecter transport avec DTLS parameters
  - `POST /produce`: Créer producer audio/video
  - `POST /consume`: Créer consumer pour peer

- **Configuration Audio Optimisée**
  - Codec Opus 48kHz stereo, 256kbps
  - FEC (Forward Error Correction) activé
  - DTX (Discontinuous Transmission) activé
  - NACK, PLI, FIR activés pour récupération erreurs

### 🔧 Modifié

- **Ports WebRTC**: Changement de 10000-10100 → 7500-8000 (contrainte ≤8100)
  - `docker-compose.yml`: Ports UDP/TCP 7500-8000 mappés
  - `.env.example`: VOICE_RTC_MIN_PORT=7500, VOICE_RTC_MAX_PORT=8000
  - `voice-server.ts`: Defaults à 7500/8000
  - Documentation: VOICE_SYSTEM.md, CLIENT_IMPLEMENTATION_STATUS.md mis à jour

- **WebSocket Service** (`websocket.ts`)
  - Ajout méthodes génériques `emit(event, data)`, `on(event, callback)`, `off(event, callback?)`
  - Support événements vocaux en plus des événements chat/DM

### 📚 Documentation

- `VOICE_SYSTEM.md`: Documentation complète système vocal serveur
- `CLIENT_VOICE_IMPLEMENTATION.md`: Guide implémentation vocale client
- `VOICE_CLIENT_COMPLETE.md`: Récapitulatif complet avec tests
- Mise à jour `CORRECTIONS_APPLIED.md` avec corrections ports
- Mise à jour `FINAL_VERIFICATION.md` avec vérifications vocales

### 📦 Dépendances

- **Client**: `mediasoup-client@^3.7.11` (+ 10 packages: h264-profile-level-id, sdp-transform, etc.)
- **Serveur**: `mediasoup@^3.14.19`

### 🧪 Tests

- Compilation serveur: ✅ SUCCESS
- Compilation client: ✅ SUCCESS (531.46 kB bundle)
- 0 erreurs TypeScript sur serveur et client

### 📊 Statistiques

**Vocal Client**:
- `voice.ts`: 474 lignes
- `voiceStore.ts`: 127 lignes
- `VoiceControls.tsx`: 174 lignes + 259 lignes CSS
- Extensions API/WebSocket: ~56 lignes
- **Total**: ~1090 lignes

**Paramètres Client**:
- `settingsStore.ts`: 246 lignes
- `audioSettings.ts`: 281 lignes
- `Settings.tsx`: 441 lignes + 440 lignes CSS
- **Total**: ~1408 lignes

**Total Nouveau Code Client**: ~2500 lignes TypeScript + ~700 lignes CSS

## [1.1.0] - 2025-10-23

### ✨ Ajouté

- **Création Dynamique de Bases de Données** 🎉
  - Les bases de données serveur sont maintenant créées automatiquement lors de la création d'un serveur
  - Nouvelle méthode `DatabaseManager.createServerDatabase()` pour créer physiquement les DB PostgreSQL
  - Initialisation automatique du schéma complet (tables, indexes, fonctions)
  - Rollback automatique en cas d'échec de création de DB
  - Documentation complète dans `DYNAMIC_DATABASE_CREATION.md`

- **Architecture PostgreSQL Unifié**
  - Nouveau fichier `docker-compose.unified.yml` avec un seul conteneur PostgreSQL
  - Script d'initialisation `00-init-databases.sh` pour créer les DB de base
  - Support de plusieurs bases de données sur le même serveur PostgreSQL
  - Configuration optimisée (max_connections=200, shared_buffers=256MB)

- **Sécurité Renforcée**
  - Chiffrement AES-256-CBC des mots de passe DB dans le registre
  - Variables d'environnement pour credentials admin PostgreSQL (`DB_ADMIN_USER`, `DB_ADMIN_PASSWORD`)
  - Isolation complète des données entre serveurs

- **Documentation**
  - Guide complet de la création dynamique (`DYNAMIC_DATABASE_CREATION.md`)
  - Guide de démarrage rapide pour l'architecture unifiée (`QUICKSTART_UNIFIED.md`)
  - Script de test PowerShell (`test-dynamic-db.ps1`)
  - Instructions de migration depuis l'architecture séparée
  - `.env.example` mis à jour avec les nouvelles variables

### 🔧 Modifié

- `src/utils/database.ts`
  - Ajout de `createServerDatabase()` pour création dynamique
  - Ajout de `initializeServerSchema()` pour initialiser le schéma complet
  - Amélioration du logging pour les opérations de création de DB
  
- `src/routes/servers.ts`
  - Implémentation de la création physique de DB lors de `POST /api/servers`
  - Ajout de rollback si la création de DB échoue
  - Masquage du mot de passe DB chiffré dans les réponses API
  - Utilisation de `dbManager.queryServer()` au lieu de `serverPool.query()`

- `docker-compose.yml`
  - Ajout des variables `DB_HOST`, `DB_PORT`, `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD`

- `README.md`
  - Mention de la fonctionnalité de création dynamique dans les features

### 🐛 Corrigé

- Correction de l'utilisation directe du pool serveur (maintenant via `dbManager.queryServer()`)
- Gestion correcte des erreurs lors de la création de serveur
- Rollback complet (registry + membres) en cas d'échec de création de DB

### 📚 Documentation

- Ajout de commentaires détaillés dans le code pour la création dynamique
- Documentation des variables d'environnement requises
- Exemples de commandes PostgreSQL pour monitoring
- Guide de dépannage pour les erreurs courantes

### 🧪 Tests

- Nouveau script de test `test-dynamic-db.ps1` pour valider la création dynamique
- Tests de création de plusieurs serveurs successifs
- Vérification de l'isolation des données entre serveurs
- Validation du schéma complet de chaque DB serveur

### 🔒 Sécurité

- Les mots de passe DB sont chiffrés avant stockage dans `registry_db`
- Validation des permissions PostgreSQL (`CREATEDB` pour `ohkay_user`)
- Nettoyage automatique en cas d'échec de création
- Logs détaillés sans exposer les credentials

### 📊 Performance

- Lazy loading des connexions aux DB serveur (création à la demande)
- Pool de connexions par serveur avec gestion optimisée
- Index PostgreSQL appropriés sur toutes les tables
- Configuration PostgreSQL optimisée pour multi-DB

### ⚠️ Notes de Migration

Si vous utilisez l'architecture séparée actuelle (`docker-compose.yml`), deux options :

1. **Continuer avec l'architecture séparée** : Aucun changement requis, mais pas de création dynamique
2. **Migrer vers l'architecture unifiée** : Suivre le guide dans `DYNAMIC_DATABASE_CREATION.md` section "Migration"

L'architecture unifiée est **recommandée** pour :
- Facilité de gestion
- Moins de ressources
- Création dynamique de serveurs
- Scalabilité

---

## [1.0.0] - 2025-10-22

### ✨ Version Initiale - Système de Permissions Complet

#### **49 Permissions Flags Implémentées** 🔐

**Permissions Générales du Serveur**:
- `ADMINISTRATOR` (0x1): Toutes permissions, bypass channel overrides
- `VIEW_AUDIT_LOG` (0x2): Voir les logs d'audit
- `MANAGE_GUILD` (0x4): Modifier nom, description, région serveur
- `MANAGE_ROLES` (0x8): Créer, modifier, supprimer, attribuer rôles
- `MANAGE_CHANNELS` (0x10): Créer, modifier, supprimer channels
- `KICK_MEMBERS` (0x20): Expulser membres du serveur
- `BAN_MEMBERS` (0x40): Bannir/débannir membres
- `CREATE_INSTANT_INVITE` (0x80): Créer liens d'invitation
- `CHANGE_NICKNAME` (0x100): Changer son propre pseudo
- `MANAGE_NICKNAMES` (0x200): Changer pseudo des autres membres
- `MANAGE_GUILD_EXPRESSIONS` (0x400): Créer, modifier, supprimer emojis custom
- `CREATE_GUILD_EXPRESSIONS` (0x800): Créer emojis custom seulement
- `VIEW_GUILD_INSIGHTS` (0x1000): Voir statistiques du serveur
- `MANAGE_WEBHOOKS` (0x2000): Créer, modifier, supprimer webhooks

**Permissions Channels**:
- `VIEW_CHANNEL` (0x4000): Voir le channel
- `MANAGE_MESSAGES` (0x8000): Supprimer/épingler messages des autres
- `SEND_MESSAGES` (0x10000): Envoyer messages
- `SEND_TTS_MESSAGES` (0x20000): Envoyer messages TTS
- `EMBED_LINKS` (0x40000): Liens automatiquement transformés en embeds
- `ATTACH_FILES` (0x80000): Uploader fichiers/images
- `READ_MESSAGE_HISTORY` (0x100000): Voir historique messages
- `MENTION_EVERYONE` (0x200000): Mention @everyone et @here
- `USE_EXTERNAL_EMOJIS` (0x400000): Utiliser emojis d'autres serveurs
- `ADD_REACTIONS` (0x800000): Ajouter réactions aux messages
- `USE_SLASH_COMMANDS` (0x1000000): Utiliser commandes slash
- `MANAGE_THREADS` (0x2000000): Créer, supprimer, archiver threads
- `CREATE_PUBLIC_THREADS` (0x4000000): Créer threads publics
- `CREATE_PRIVATE_THREADS` (0x8000000): Créer threads privés
- `USE_EXTERNAL_STICKERS` (0x10000000): Utiliser stickers d'autres serveurs
- `SEND_MESSAGES_IN_THREADS` (0x20000000): Envoyer dans threads
- `SEND_VOICE_MESSAGES` (0x40000000): Envoyer messages vocaux

**Permissions Vocales**:
- `CONNECT` (0x80000000): Se connecter au channel vocal
- `SPEAK` (0x100000000): Parler dans le channel
- `MUTE_MEMBERS` (0x200000000): Mute d'autres membres
- `DEAFEN_MEMBERS` (0x400000000): Deafen d'autres membres
- `MOVE_MEMBERS` (0x800000000): Déplacer membres entre channels vocaux
- `USE_VAD` (0x1000000000): Utiliser Voice Activity Detection
- `PRIORITY_SPEAKER` (0x2000000000): Voix prioritaire (plus fort)
- `STREAM` (0x4000000000): Partager écran/stream vidéo
- `USE_EMBEDDED_ACTIVITIES` (0x8000000000): Utiliser activités intégrées
- `USE_SOUNDBOARD` (0x10000000000): Utiliser soundboard
- `USE_EXTERNAL_SOUNDS` (0x20000000000): Utiliser sons externes

**Permissions Avancées**:
- `REQUEST_TO_SPEAK` (0x40000000000): Demander parole (stage channels)
- `MANAGE_EVENTS` (0x80000000000): Créer, modifier événements
- `MODERATE_MEMBERS` (0x100000000000): Timeout membres
- `VIEW_CREATOR_MONETIZATION_ANALYTICS` (0x200000000000): Voir analytics monétisation
- `USE_CLYDE_AI` (0x400000000000): Utiliser Clyde AI
- `SET_VOICE_CHANNEL_STATUS` (0x800000000000): Définir statut channel vocal
- `SEND_POLLS` (0x1000000000000): Créer sondages
- `USE_EXTERNAL_APPS` (0x2000000000000): Utiliser apps externes

#### **Système de Permissions Implémenté** ⚙️

**Fichier `permissions-flags.ts`** (382 lignes):
- 49 permissions en bitwise avec BigInt (jusqu'à 2^48)
- `DEFAULT_PERMISSIONS`: Permissions de base pour @everyone
- `OWNER_PERMISSIONS`: Toutes permissions pour le propriétaire
- `hasPermission()`: Vérifie si une permission est active (bitwise AND)
- `permissionsToBigInt()`: Convertit BigInt → string pour PostgreSQL
- `bigIntToPermissions()`: Convertit string → BigInt
- Export complet de tous les flags

**Fichier `permissions.ts` (292 lignes)**:
- `checkServerMembership`: Middleware vérification membre du serveur
- `checkServerOwnership`: Middleware vérification propriétaire
- `checkDMAccess`: Middleware vérification accès DM
- `getUserPermissions()`: Calcule permissions complètes d'un user
  - Combine @everyone + tous les rôles de l'utilisateur (bitwise OR)
  - Si ADMINISTRATOR → retourne toutes permissions
  - Owner → retourne OWNER_PERMISSIONS
- `getUserChannelPermissions()`: Calcule permissions dans un channel
  - Récupère permissions de base du serveur
  - Applique overrides du channel (rôles puis user)
  - Gère ALLOW/DENY avec priorités Discord
  - Owner et ADMINISTRATOR bypass tout

**Routes de Gestion Permissions**:
- `GET /api/permissions/:serverId/members/:memberId`: Permissions complètes membre
- `GET /api/permissions/:serverId/channels/:channelId/members/:memberId`: Permissions channel
- `POST /api/permissions/:serverId/channels/:channelId/overrides`: Créer override (role/user)
- `DELETE /api/permissions/:serverId/channels/:channelId/overrides`: Supprimer override
- Requiert MANAGE_ROLES ou MANAGE_CHANNELS pour gérer overrides

#### **Intégration Permissions dans Routes** 🔗

**Serveurs** (`servers.ts`):
- `PATCH /api/servers/:serverId`: MANAGE_GUILD pour modifier serveur
- Protection owner maintenue en fallback

**Channels** (`channels.ts`):
- `POST /api/servers/:serverId/channels`: MANAGE_CHANNELS pour créer channel
- `PATCH /api/servers/:serverId/channels/:channelId`: MANAGE_CHANNELS pour modifier
- `DELETE /api/servers/:serverId/channels/:channelId`: MANAGE_CHANNELS pour supprimer
- `PATCH /api/channels/:serverId/channels/:channelId/messages/:messageId`: MANAGE_MESSAGES ou message own
- `DELETE /api/channels/:serverId/channels/:channelId/messages/:messageId`: MANAGE_MESSAGES ou message own

**Messages** (`socket/handlers.ts`):
- `send_message`: SEND_MESSAGES pour envoyer
- `send_message`: ATTACH_FILES si fichiers attachés
- `send_message`: USE_EXTERNAL_EMOJIS si emojis custom externes
- Extraction et validation emojis via `canUseEmojis()`

**Réactions** (`reactions.ts`):
- `POST /add`: ADD_REACTIONS pour ajouter réaction
- `POST /add`: USE_EXTERNAL_EMOJIS si emoji externe + validation membre serveur emoji

**Fichiers** (`attachments.ts`):
- `POST /upload`: ATTACH_FILES pour upload
- Cleanup fichier si permission refusée

**Invitations** (`invites.ts`):
- `POST /create`: CREATE_INSTANT_INVITE pour créer invitation
- Configuration maxUses, expiresInHours

**Rôles** (`roles.ts`):
- `POST /create`: MANAGE_ROLES (ou owner) pour créer rôle
- `PATCH /update`: MANAGE_ROLES pour modifier
- `DELETE /delete`: MANAGE_ROLES pour supprimer (sauf @everyone)
- `POST /assign`: MANAGE_ROLES pour attribuer rôle
- `DELETE /remove`: MANAGE_ROLES pour retirer rôle

**Modération** (`moderation.ts`):
- `POST /kick`: KICK_MEMBERS (protection owner + self-kick)
- `POST /ban`: BAN_MEMBERS (protection owner + self-ban)
- `DELETE /unban`: BAN_MEMBERS pour débannir
- `PATCH /nickname`: MANAGE_NICKNAMES pour changer pseudo autres
- `PATCH /nickname`: CHANGE_NICKNAME pour changer son pseudo
- Audit log automatique pour toutes actions

**Emojis** (`emojis.ts`):
- `POST /create`: MANAGE_GUILD_EXPRESSIONS ou CREATE_GUILD_EXPRESSIONS
- `DELETE /delete`: MANAGE_GUILD_EXPRESSIONS
- `PATCH /update`: MANAGE_GUILD_EXPRESSIONS
- Cleanup fichier si permission refusée

#### **Protections Implémentées** 🛡️

1. **Owner Protection**: Owner ne peut jamais être kick/ban/modéré
2. **Self-Action Protection**: Ne peut pas se kick/ban soi-même
3. **@everyone Protection**: Rôle @everyone ne peut pas être supprimé
4. **Administrator Bypass**: ADMINISTRATOR bypass channel overrides mais pas ownership
5. **File Cleanup**: Fichiers uploadés supprimés si permission refusée

#### **Base de Données** 💾

**Table `roles`**:
- `permissions VARCHAR(20)`: Bitfield 64-bit stocké en string
- `position INTEGER`: Position dans hiérarchie (non utilisée en 1.0.0)
- `is_default BOOLEAN`: Marque le rôle @everyone
- `is_hoisted BOOLEAN`: Affichage séparé dans liste membres
- `is_mentionable BOOLEAN`: Peut être mentionné

**Table `member_roles`**:
- Relation many-to-many entre users et roles
- `PRIMARY KEY (user_id, role_id)`

**Table `channel_permission_overrides`**:
- Overrides par channel pour roles ou users
- `target_type ENUM('role', 'user')`
- `allow VARCHAR(20)`: Permissions autorisées (bitfield)
- `deny VARCHAR(20)`: Permissions refusées (bitfield)
- Priorité: User overrides > Role overrides > Base permissions

**Table `audit_log`**:
- Log toutes actions de modération
- `action VARCHAR(50)`: Type action (MEMBER_KICK, MEMBER_BAN, etc.)
- `user_id INT`: Qui a fait l'action
- `target_user_id INT`: Cible de l'action
- `reason TEXT`: Raison optionnelle

#### **Documentation** 📚

- `PERMISSIONS_VERIFICATION.md`: Audit complet de 42 routes avec vérifications
- Commentaires détaillés dans tous les fichiers de permissions
- Exemples d'utilisation des flags bitwise

#### **Statistiques** 📊

- **49 permissions** définies avec bitwise operations
- **42 routes** vérifiées avec checks de permissions
- **10 fichiers** de routes intégrés
- **5 protections** majeures implémentées
- **~1000 lignes** de code permissions (flags + routes + helpers)

---

### ✨ Version Initiale - Base

- Architecture multi-base de données (auth, dm, registry, servers)
- API REST complète pour authentification, serveurs, channels, DMs
- WebSocket temps réel avec Socket.io
- Messages avec édition, épinglage, réponses
- Réactions et attachments
- Webhooks pour intégrations
- Logging complet avec Winston
- Docker Compose avec bases de données séparées
- Sécurité (JWT, bcrypt, helmet, rate limiting)
- Health checks et graceful shutdown

---

## Format du Changelog

### Types de modifications

- **Ajouté** : Nouvelles fonctionnalités
- **Modifié** : Changements dans les fonctionnalités existantes
- **Déprécié** : Fonctionnalités bientôt supprimées
- **Supprimé** : Fonctionnalités supprimées
- **Corrigé** : Corrections de bugs
- **Sécurité** : Corrections de vulnérabilités

### Icônes

- ✨ Nouvelle fonctionnalité
- 🔧 Modification
- 🐛 Correction de bug
- 🔒 Sécurité
- 📚 Documentation
- 🧪 Tests
- 📊 Performance
- ⚠️ Important / Breaking change
- 🎉 Version majeure
