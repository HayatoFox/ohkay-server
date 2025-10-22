# 🔍 RAPPORT D'AUDIT - OHKAY SERVER

**Date:** 22 octobre 2025  
**Architecture:** Multi-DB (auth_db, dm_db, registry_db, server_X_db)  
**Statut Docker:** ✅ 4 PostgreSQL containers HEALTHY

---

## 🔴 PROBLÈMES CRITIQUES À CORRIGER

### 1. **AuthRequest Interface incomplète** (`src/routes/dms.ts`)
**Problème:** `AuthRequest` n'étend pas `Request`, donc pas de `params`, `query`, `body`

**Impact:** 13 erreurs TypeScript dans `dms.ts`
```typescript
Property 'params' does not exist on type 'AuthRequest'
Property 'query' does not exist on type 'AuthRequest'
Property 'body' does not exist on type 'AuthRequest'
```

**Solution:**
```typescript
// src/utils/auth.ts
export interface AuthRequest extends Request {
  user?: {
    userId: number;
    username: string;
    id: number;
  };
}
```

---

### 2. **Duplication du middleware `authenticateToken`**
**Problème:** Le middleware est défini dans 2 fichiers:
- ✅ `src/utils/auth.ts` (exporté correctement)
- ❌ `src/routes/servers.ts` (redéfini localement)
- ❌ `src/routes/channels.ts` (redéfini localement)

**Impact:** Maintenance difficile, code dupliqué

**Solution:** Importer depuis `utils/auth.ts` partout

---

### 3. **Routes `channels.ts` utilisent l'ancienne architecture**
**Problème:** `channels.ts` utilise encore `query()` au lieu de `dbManager.queryServer()`

**Impact:** Les channels seront créés dans la mauvaise DB (probablement auth_db)

**Exemple:**
```typescript
// ❌ MAUVAIS (channels.ts ligne 29)
const result = await query('SELECT c.*, u.username...');

// ✅ BON (devrait être)
const result = await dbManager.queryServer(serverId, 'SELECT c.*, u.username...');
```

**Actions:**
- Récupérer `serverId` depuis le channel ou la requête
- Utiliser `dbManager.queryServer(serverId, query, params)`
- Enrichir avec `dbManager.queryAuth()` pour les usernames

---

### 4. **Socket.io utilise l'ancienne architecture**
**Problème:** `socket/handlers.ts` utilise `query()` dépréciée au lieu de `dbManager`

**Impact:** Les messages/sessions seront enregistrés dans la mauvaise DB

**Solution:** Adapter tous les appels:
```typescript
// ❌ MAUVAIS
await query('INSERT INTO sessions...', [userId, socketId]);

// ✅ BON
await dbManager.queryAuth('INSERT INTO sessions...', [userId, socketId]);
await dbManager.queryServer(serverId, 'INSERT INTO messages...', [channelId, userId, content]);
```

---

### 5. **Messages privés via Socket.io utilisent l'ancienne table**
**Problème:** `socket/handlers.ts` ligne 165 insère dans `messages` au lieu de `dm_messages`

**Code actuel:**
```typescript
await query(
  `INSERT INTO messages (user_id, recipient_id, content, is_private) 
   VALUES ($1, $2, $3, TRUE)`
);
```

**Impact:** Les DMs ne seront PAS enregistrés correctement

**Solution:** Utiliser la nouvelle architecture DM:
```typescript
// 1. Récupérer ou créer conversation
const convResult = await dbManager.queryDM(
  'SELECT get_or_create_conversation($1, $2) as conversation_id',
  [socket.userId, recipientId]
);

// 2. Insérer le message
await dbManager.queryDM(
  'INSERT INTO dm_messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)',
  [convResult.rows[0].conversation_id, socket.userId, content]
);

// 3. Émettre vers les deux utilisateurs
io.to(`user:${socket.userId}`).emit('new_private_message', fullMessage);
io.to(`user:${recipientId}`).emit('new_private_message', fullMessage);
```

---

## 🟡 PROBLÈMES DE SÉCURITÉ

### 6. **Mots de passe DB en clair dans le registre**
**Problème:** `servers.ts` ligne 94 stocke `DB_PASSWORD` en clair

```typescript
db_password_encrypted: process.env.DB_PASSWORD // TODO: Chiffrer
```

**Impact:** 🔴 CRITIQUE - Les credentials DB sont exposés

**Solution:** Utiliser `encryptPassword()` du DatabaseManager:
```typescript
import crypto from 'crypto';

// Dans servers.ts
db_password_encrypted: encryptDBPassword(process.env.DB_PASSWORD!)
```

---

### 7. **Pas de validation de longueur pour les noms de serveur**
**Problème:** `servers.ts` ligne 62-65 ne valide pas la longueur du nom

**Impact:** Risque de dépassement DB, injection potentielle

**Solution:**
```typescript
if (!name || name.trim().length === 0) {
  return res.status(400).json({ error: 'Server name is required' });
}

if (name.length > 100) {
  return res.status(400).json({ error: 'Server name too long (max 100 characters)' });
}
```

---

### 8. **Pas de rate limiting spécifique pour les DMs**
**Problème:** Les DMs utilisent le rate limit global (100 req/15min)

**Impact:** Risque de spam DM

**Solution:** Ajouter un rate limiter spécifique:
```typescript
const dmLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 DMs par minute
  message: 'Too many messages, please slow down',
});

app.use('/api/dms/:conversationId/messages', dmLimiter);
```

---

## 🟢 OPTIMISATIONS RECOMMANDÉES

### 9. **Mise en cache des infos utilisateurs**
**Problème:** Chaque message DM/serveur fait un `queryAuth()` pour récupérer username/avatar

**Impact:** N+1 queries, latence élevée

**Solution:** Utiliser Redis ou cache en mémoire:
```typescript
import NodeCache from 'node-cache';
const userCache = new NodeCache({ stdTTL: 300 }); // 5 min

async function getUserInfo(userId: number) {
  const cached = userCache.get(`user_${userId}`);
  if (cached) return cached;
  
  const result = await dbManager.queryAuth('SELECT...', [userId]);
  userCache.set(`user_${userId}`, result.rows[0]);
  return result.rows[0];
}
```

---

### 10. **Pagination inefficace pour les messages**
**Problème:** `dms.ts` ligne 153 fait `ORDER BY created_at DESC` sans index

**Impact:** Performance dégradée avec beaucoup de messages

**Solution:** Ajouter index dans `init-scripts/dms.sql`:
```sql
CREATE INDEX idx_dm_messages_conversation_created 
ON dm_messages(conversation_id, created_at DESC) 
WHERE deleted_at IS NULL;
```

---

### 11. **Pas de pooling pour les connexions serveur**
**Problème:** `database.ts` crée un nouveau pool à chaque `getServerDB(serverId)`

**Impact:** ✅ Déjà optimal (lazy loading avec Map)

**Suggestion:** Ajouter TTL pour fermer les pools inactifs:
```typescript
private serverPoolTimestamps: Map<number, number> = new Map();

// Après création du pool
this.serverPoolTimestamps.set(serverId, Date.now());

// Fonction de nettoyage toutes les heures
setInterval(() => {
  const now = Date.now();
  const TTL = 60 * 60 * 1000; // 1 heure
  
  for (const [serverId, timestamp] of this.serverPoolTimestamps.entries()) {
    if (now - timestamp > TTL) {
      this.serverPools.get(serverId)?.end();
      this.serverPools.delete(serverId);
      this.serverPoolTimestamps.delete(serverId);
    }
  }
}, 60 * 60 * 1000);
```

---

### 12. **Logs trop verbeux en production**
**Problème:** Beaucoup de `logger.info()` pour chaque requête

**Solution:** Utiliser des niveaux appropriés:
```typescript
// ❌ MAUVAIS (production pollué)
logger.info('Query executed', { db: 'AUTH_DB', duration: 5 });

// ✅ BON
logger.debug('Query executed', { db: 'AUTH_DB', duration: 5 });
logger.warn('Slow query detected', { db: 'AUTH_DB', duration: 500 }); // Si > 500ms
```

---

### 13. **Pas de health check pour les server DBs**
**Problème:** `database.ts` ligne 286 vérifie seulement auth/dm/registry

**Solution:**
```typescript
async healthCheck(): Promise<{ [key: string]: boolean }> {
  const health: { [key: string]: boolean } = {};
  
  // ... auth_db, dm_db, registry_db ...
  
  // Vérifier les server DBs actifs
  for (const [serverId, pool] of this.serverPools.entries()) {
    try {
      await pool.query('SELECT 1');
      health[`server_${serverId}_db`] = true;
    } catch (error) {
      health[`server_${serverId}_db`] = false;
      logger.error(`SERVER_${serverId}_DB health check failed`, { error });
    }
  }
  
  return health;
}
```

---

### 14. **Améliorer la gestion des transactions**
**Problème:** Certaines opérations multi-étapes ne sont pas dans des transactions

**Exemple critique:** `servers.ts` ligne 80-105 (création serveur)

**Solution:**
```typescript
const client = await dbManager.getRegistryClient();

try {
  await client.query('BEGIN');
  
  // 1. Créer serveur
  const serverResult = await client.query('INSERT INTO servers...');
  
  // 2. Ajouter membre
  await client.query('INSERT INTO server_members...');
  
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

---

## 📊 RÉSUMÉ DES ACTIONS

### 🔴 URGENT (À corriger maintenant)
1. ✅ Corriger `AuthRequest` interface
2. ✅ Refactoriser `channels.ts` pour multi-DB
3. ✅ Refactoriser `socket/handlers.ts` pour multi-DB
4. ✅ Chiffrer mots de passe DB dans le registre
5. ✅ Corriger DM Socket.io (utiliser dm_db)

### 🟡 IMPORTANT (Cette semaine)
6. Supprimer duplications de `authenticateToken`
7. Ajouter validation longueur noms serveurs
8. Ajouter rate limiting spécifique DMs
9. Ajouter indexes pour pagination

### 🟢 RECOMMANDÉ (Prochaine itération)
10. Implémenter cache utilisateurs (Redis/NodeCache)
11. Ajouter TTL pour server pools inactifs
12. Améliorer niveaux de logs
13. Ajouter health check server DBs
14. Utiliser transactions pour opérations critiques

---

## 🎯 SCORE DE QUALITÉ

| Catégorie | Score | Commentaire |
|-----------|-------|-------------|
| Architecture | 9/10 | Excellente séparation multi-DB |
| Sécurité | 6/10 | Manque chiffrement DB passwords |
| Performance | 7/10 | Bon, mais cache manquant |
| Logging | 8/10 | Complet, mais trop verbeux |
| Gestion erreurs | 8/10 | Bien implémenté partout |
| Tests | 0/10 | ❌ Aucun test unitaire |

**Score global: 7.2/10** ⭐⭐⭐⭐ (Bon, mais améliorable)

---

## 🚀 PROCHAINES ÉTAPES

**Veux-tu que je corrige les problèmes critiques maintenant ?**

1. Corriger `AuthRequest` interface ✅
2. Refactoriser `channels.ts` pour multi-DB ✅
3. Refactoriser `socket/handlers.ts` pour multi-DB ✅
4. Ajouter chiffrement passwords DB ✅
5. Corriger DM Socket.io ✅
