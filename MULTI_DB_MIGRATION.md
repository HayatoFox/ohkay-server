# 🔄 RESTRUCTURATION MULTI-DATABASE - RÉSUMÉ COMPLET

Date: 2025-10-22
Type: Architecture majeure changement

## 📊 NOUVELLE ARCHITECTURE

### Avant (1 base de données)
```
ohkay_db (PostgreSQL unique)
├── users
├── servers
├── channels
├── messages (serveur + DMs mélangés)
├── roles
├── server_members
└── ...
```

### Après (4+ bases de données)
```
┌─────────────────────────────────────────┐
│          OHKAY INSTANCE                 │
├─────────────────────────────────────────┤
│ auth-db (PostgreSQL)                    │
│ ├── users                               │
│ ├── user_profiles                       │
│ ├── sessions                            │
│ └── login_history                       │
├─────────────────────────────────────────┤
│ dm-db (PostgreSQL)                      │
│ ├── dm_conversations                    │
│ ├── dm_messages                         │
│ └── dm_read_status                      │
├─────────────────────────────────────────┤
│ registry-db (PostgreSQL)                │
│ ├── servers (métadonnées)               │
│ ├── server_members                      │
│ ├── server_bans                         │
│ └── server_stats                        │
├─────────────────────────────────────────┤
│ server-1-db (PostgreSQL)                │
│ ├── channels                            │
│ ├── messages                            │
│ ├── roles                               │
│ ├── member_roles                        │
│ ├── invites                             │
│ └── audit_log                           │
├─────────────────────────────────────────┤
│ server-2-db (PostgreSQL)                │
│ └── ... (même structure)                │
└─────────────────────────────────────────┘
```

## ✅ CE QUI A ÉTÉ FAIT

### 1. Fichiers SQL d'initialisation (init-scripts/)
- ✅ `auth.sql` - Base authentification avec profils séparés
- ✅ `dms.sql` - Base DMs avec fonction get_or_create_conversation()
- ✅ `registry.sql` - Registre avec métadonnées serveurs et stats
- ✅ `server_template.sql` - Template pour chaque nouveau serveur

### 2. DatabaseManager (src/utils/database.ts)
- ✅ Classe singleton avec 4 pools:
  - `authPool` - Connexion auth-db
  - `dmPool` - Connexion dm-db
  - `registryPool` - Connexion registry-db
  - `serverPools` - Map dynamique des connexions serveurs
- ✅ Méthodes helper:
  - `queryAuth()`, `queryDM()`, `queryRegistry()`, `queryServer()`
  - `getAuthDB()`, `getDMDB()`, `getRegistryDB()`, `getServerDB()`
  - `healthCheck()` - Vérifie santé des 3 DBs principales
  - `closeAll()` - Fermeture propre de toutes les connexions
- ✅ Lazy loading des connexions serveur
- ✅ Chiffrement/déchiffrement des mots de passe DB dans registry

### 3. Docker Compose (docker-compose.yml)
- ✅ 4 services PostgreSQL:
  - `auth-db` - Port interne 5432
  - `dm-db` - Port interne 5432
  - `registry-db` - Port interne 5432
  - `server-1-db` - Port interne 5432
- ✅ Health checks sur chaque DB
- ✅ Volumes séparés pour isolation
- ✅ Dépendances dans l'ordre de démarrage

### 4. Routes Backend
- ✅ **auth.ts** - Utilise `authPool` pour users + profiles
- ✅ **dms.ts** - NOUVELLE route pour DMs séparés
  - `GET /api/dms` - Liste conversations
  - `POST /api/dms/:recipientId` - Créer/récupérer conversation
  - `GET /api/dms/:conversationId/messages` - Récupérer messages
  - `POST /api/dms/:conversationId/messages` - Envoyer message
  - `DELETE /api/dms/:conversationId/messages/:messageId` - Supprimer
- ✅ **servers.ts** - Utilise `registryPool` + `getServerDB()`
  - Liste serveurs depuis registry
  - Création serveur avec entrée registry + DB dédiée
  - Membres depuis registry, channels/messages depuis server DB
- ✅ **index.ts** - Ajout route `/api/dms`, health check multi-DB

### 5. Variables d'environnement (.env.example)
- ✅ AUTH_DB_HOST, AUTH_DB_PORT, AUTH_DB_NAME
- ✅ DM_DB_HOST, DM_DB_PORT, DM_DB_NAME
- ✅ REGISTRY_DB_HOST, REGISTRY_DB_PORT, REGISTRY_DB_NAME
- ✅ DB_USER, DB_PASSWORD (partagés)
- ✅ DB_ENCRYPTION_KEY (pour chiffrement registry)

## ⚠️ À FAIRE (TODO)

### Backend
- [ ] **channels.ts** - Adapter pour `dbManager.queryServer(serverId, ...)`
- [ ] **socket/handlers.ts** - Utiliser bons pools pour messages
- [ ] **Script migration** - Migrer anciennes données vers nouvelle archi
- [ ] **test-api.ps1** - Adapter tests pour DMs séparés
- [ ] **Création dynamique DB serveur** - Actuellement utilise server-1-db

### Client (À NE PAS OUBLIER!)
- [ ] **client/src/api/dms.ts** - Nouvelles routes `/api/dms`
- [ ] **client/src/store/dmStore.ts** - Store Zustand pour DMs
- [ ] **client/src/components/DMList.tsx** - Liste conversations DM
- [ ] **client/src/components/ChatArea.tsx** - Adapter pour DM ou channel

## 🔑 POINTS CLÉS

### Sécurité ✅
- **Isolation totale** : Hack d'un serveur ≠ hack des autres
- **Séparation DMs** : Messages privés dans DB dédiée
- **Chiffrement** : Mots de passe DB chiffrés dans registry

### Performance ✅
- **Scaling horizontal** : Chaque serveur peut être sur un host différent
- **Tables plus petites** : Messages répartis par serveur
- **Queries plus rapides** : Indexes optimisés par DB

### Flexibilité ✅
- **Migration serveur** : Déplacer une DB = déplacer le serveur
- **Backup granulaire** : Backup un seul serveur possible
- **Archivage** : Serveur inactif = DB archivable séparément

## 📚 NOUVELLES API ENDPOINTS

### DMs (Messages Privés)
```
GET    /api/dms                            - Liste conversations
POST   /api/dms/:recipientId               - Créer/récupérer conversation
GET    /api/dms/:conversationId/messages   - Messages conversation
POST   /api/dms/:conversationId/messages   - Envoyer message DM
DELETE /api/dms/:conversationId/messages/:messageId - Supprimer message
```

### Serveurs (Modifiées)
```
GET    /api/servers                        - Liste depuis registry
POST   /api/servers                        - Créer serveur + DB dédiée
GET    /api/servers/:id/channels           - Channels depuis server-DB
GET    /api/servers/:id/members            - Membres depuis registry + auth
```

## 🚀 PROCHAINES ÉTAPES RECOMMANDÉES

1. **Finir adaptation backend**
   - channels.ts
   - socket/handlers.ts
   - tests

2. **Adapter le client**
   - Store DM séparé
   - Composants DM UI
   - API calls vers `/api/dms`

3. **Script de migration**
   - Exporter données anciennes
   - Importer dans nouvelle structure
   - Validation des données

4. **Tests complets**
   - Tests unitaires multi-DB
   - Tests d'intégration
   - Tests de performance

5. **Documentation**
   - Mettre à jour PROJECT_STATE.txt
   - Mettre à jour CLIENT_API_SPECS.txt
   - Guide de migration

## ⚡ COMMANDES UTILES

```powershell
# Démarrer avec nouvelle architecture
docker-compose down -v
docker-compose up -d --build

# Voir logs des DBs
docker-compose logs -f auth-db
docker-compose logs -f dm-db
docker-compose logs -f registry-db
docker-compose logs -f server-1-db

# Accéder à une DB
docker exec -it ohkay-auth-db psql -U ohkay_user -d ohkay_auth
docker exec -it ohkay-dm-db psql -U ohkay_user -d ohkay_dms
docker exec -it ohkay-registry-db psql -U ohkay_user -d ohkay_server_registry
docker exec -it ohkay-server-1-db psql -U ohkay_user -d ohkay_server_1
```

## 🔍 VÉRIFICATIONS

Avant de considérer la migration complète:
- [ ] Toutes les bases démarrent correctement
- [ ] Health check passe pour les 3 DBs principales
- [ ] Inscription/connexion fonctionne (auth-db)
- [ ] DMs fonctionnent (dm-db)
- [ ] Création serveur fonctionne (registry + server-db)
- [ ] Channels et messages fonctionnent (server-db)
- [ ] Client adapté et fonctionnel

## 📝 NOTES IMPORTANTES

- **Backward compatibility** : L'ancienne API `query()` est dépréciée mais toujours disponible
- **Chiffrement DB** : Les mots de passe DB dans registry doivent être chiffrés en prod
- **Création dynamique** : Pour l'instant, utilise server-1-db. À améliorer pour créer DBs à la volée
- **Foreign keys logiques** : Les FKs entre DBs ne sont que logiques (pas de contraintes PostgreSQL)
- **Transactions distribuées** : Pas implémentées pour l'instant (à considérer si nécessaire)

---

**Architecture conçue pour:**
- ✅ Sécurité maximale
- ✅ Performance optimale
- ✅ Scaling horizontal
- ✅ Isolation des données
- ✅ Flexibilité opérationnelle
