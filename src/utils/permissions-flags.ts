/**
 * Système de permissions type Discord - COMPLET
 * Chaque permission est un bit dans un BigInt (64 bits)
 * Basé sur les permissions Discord officielles
 */

export const PermissionFlags = {
  // ===== PERMISSIONS GÉNÉRALES DE SERVEUR =====
  CREATE_INSTANT_INVITE: 1n << 0n,          // 0x0000000001 - Créer des invitations
  KICK_MEMBERS: 1n << 1n,                   // 0x0000000002 - Expulser des membres
  BAN_MEMBERS: 1n << 2n,                    // 0x0000000004 - Bannir des membres
  ADMINISTRATOR: 1n << 3n,                  // 0x0000000008 - Administrateur (bypass tout)
  MANAGE_CHANNELS: 1n << 4n,                // 0x0000000010 - Gérer les salons
  MANAGE_GUILD: 1n << 5n,                   // 0x0000000020 - Gérer le serveur
  ADD_REACTIONS: 1n << 6n,                  // 0x0000000040 - Ajouter des réactions
  VIEW_AUDIT_LOG: 1n << 7n,                 // 0x0000000080 - Voir les logs d'audit
  PRIORITY_SPEAKER: 1n << 8n,               // 0x0000000100 - Voix prioritaire
  STREAM: 1n << 9n,                         // 0x0000000200 - Vidéo/Partage d'écran
  VIEW_CHANNEL: 1n << 10n,                  // 0x0000000400 - Voir les salons
  SEND_MESSAGES: 1n << 11n,                 // 0x0000000800 - Envoyer des messages
  SEND_TTS_MESSAGES: 1n << 12n,             // 0x0000001000 - Envoyer des messages TTS
  MANAGE_MESSAGES: 1n << 13n,               // 0x0000002000 - Gérer les messages
  EMBED_LINKS: 1n << 14n,                   // 0x0000004000 - Intégrer des liens
  ATTACH_FILES: 1n << 15n,                  // 0x0000008000 - Joindre des fichiers
  READ_MESSAGE_HISTORY: 1n << 16n,          // 0x0000010000 - Lire l'historique
  MENTION_EVERYONE: 1n << 17n,              // 0x0000020000 - Mentionner @everyone/@here
  USE_EXTERNAL_EMOJIS: 1n << 18n,           // 0x0000040000 - Utiliser emojis externes
  VIEW_GUILD_INSIGHTS: 1n << 19n,           // 0x0000080000 - Voir les stats du serveur
  CONNECT: 1n << 20n,                       // 0x0000100000 - Se connecter (vocal)
  SPEAK: 1n << 21n,                         // 0x0000200000 - Parler
  MUTE_MEMBERS: 1n << 22n,                  // 0x0000400000 - Rendre muet des membres
  DEAFEN_MEMBERS: 1n << 23n,                // 0x0000800000 - Mettre en sourdine
  MOVE_MEMBERS: 1n << 24n,                  // 0x0001000000 - Déplacer des membres
  USE_VAD: 1n << 25n,                       // 0x0002000000 - Utiliser la détection vocale
  CHANGE_NICKNAME: 1n << 26n,               // 0x0004000000 - Changer son pseudo
  MANAGE_NICKNAMES: 1n << 27n,              // 0x0008000000 - Gérer les pseudos
  MANAGE_ROLES: 1n << 28n,                  // 0x0010000000 - Gérer les rôles
  MANAGE_WEBHOOKS: 1n << 29n,               // 0x0020000000 - Gérer les webhooks
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,      // 0x0040000000 - Gérer emojis/stickers/sons
  USE_APPLICATION_COMMANDS: 1n << 31n,      // 0x0080000000 - Utiliser les commandes
  REQUEST_TO_SPEAK: 1n << 32n,              // 0x0100000000 - Demander la parole (Stage)
  MANAGE_EVENTS: 1n << 33n,                 // 0x0200000000 - Gérer les événements
  MANAGE_THREADS: 1n << 34n,                // 0x0400000000 - Gérer les fils
  CREATE_PUBLIC_THREADS: 1n << 35n,         // 0x0800000000 - Créer des fils publics
  CREATE_PRIVATE_THREADS: 1n << 36n,        // 0x1000000000 - Créer des fils privés
  USE_EXTERNAL_STICKERS: 1n << 37n,         // 0x2000000000 - Utiliser stickers externes
  SEND_MESSAGES_IN_THREADS: 1n << 38n,      // 0x4000000000 - Envoyer dans les fils
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,       // 0x8000000000 - Utiliser les activités
  MODERATE_MEMBERS: 1n << 40n,              // 0x10000000000 - Timeout des membres
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 1n << 41n, // 0x20000000000 - Voir analytics monétisation
  USE_SOUNDBOARD: 1n << 42n,                // 0x40000000000 - Utiliser la soundboard
  CREATE_GUILD_EXPRESSIONS: 1n << 43n,      // 0x80000000000 - Créer emojis/stickers/sons
  CREATE_EVENTS: 1n << 44n,                 // 0x100000000000 - Créer des événements
  USE_EXTERNAL_SOUNDS: 1n << 45n,           // 0x200000000000 - Utiliser sons externes
  SEND_VOICE_MESSAGES: 1n << 46n,           // 0x400000000000 - Envoyer messages vocaux
  SEND_POLLS: 1n << 47n,                    // 0x800000000000 - Envoyer des sondages
  USE_EXTERNAL_APPS: 1n << 48n,             // 0x1000000000000 - Utiliser apps externes
} as const;

export const ALL_PERMISSIONS = Object.values(PermissionFlags).reduce(
  (acc, val) => acc | val,
  0n
);

// Permissions par défaut pour @everyone (comme Discord)
export const DEFAULT_PERMISSIONS =
  PermissionFlags.CREATE_INSTANT_INVITE |
  PermissionFlags.CHANGE_NICKNAME |
  PermissionFlags.VIEW_CHANNEL |
  PermissionFlags.SEND_MESSAGES |
  PermissionFlags.SEND_MESSAGES_IN_THREADS |
  PermissionFlags.CREATE_PUBLIC_THREADS |
  PermissionFlags.EMBED_LINKS |
  PermissionFlags.ATTACH_FILES |
  PermissionFlags.ADD_REACTIONS |
  PermissionFlags.USE_EXTERNAL_EMOJIS |
  PermissionFlags.USE_EXTERNAL_STICKERS |
  PermissionFlags.MENTION_EVERYONE | // Souvent désactivé mais présent par défaut
  PermissionFlags.READ_MESSAGE_HISTORY |
  PermissionFlags.SEND_VOICE_MESSAGES |
  PermissionFlags.SEND_POLLS |
  PermissionFlags.USE_APPLICATION_COMMANDS |
  PermissionFlags.CONNECT |
  PermissionFlags.SPEAK |
  PermissionFlags.STREAM |
  PermissionFlags.USE_VAD |
  PermissionFlags.USE_SOUNDBOARD |
  PermissionFlags.USE_EXTERNAL_SOUNDS |
  PermissionFlags.USE_EMBEDDED_ACTIVITIES;

export const OWNER_PERMISSIONS = ALL_PERMISSIONS;

/**
 * Vérifier si un utilisateur a une permission spécifique
 */
export function hasPermission(
  userPermissions: bigint,
  permission: bigint
): boolean {
  // Si ADMINISTRATOR, toujours true
  if ((userPermissions & PermissionFlags.ADMINISTRATOR) !== 0n) {
    return true;
  }
  return (userPermissions & permission) !== 0n;
}

/**
 * Ajouter une permission
 */
export function addPermission(
  currentPermissions: bigint,
  permission: bigint
): bigint {
  return currentPermissions | permission;
}

/**
 * Retirer une permission
 */
export function removePermission(
  currentPermissions: bigint,
  permission: bigint
): bigint {
  return currentPermissions & ~permission;
}

/**
 * Calculer les permissions finales d'un membre dans un channel
 * Prend en compte: rôles, overrides de channel, propriétaire
 */
export function computeFinalPermissions(
  isOwner: boolean,
  basePermissions: bigint,
  channelOverrides?: {
    allowPermissions: bigint;
    denyPermissions: bigint;
  }
): bigint {
  // Owner a toujours toutes les permissions
  if (isOwner) {
    return OWNER_PERMISSIONS;
  }

  let permissions = basePermissions;

  // Si ADMINISTRATOR, bypass channel overrides
  if ((permissions & PermissionFlags.ADMINISTRATOR) !== 0n) {
    return ALL_PERMISSIONS;
  }

  // Appliquer les overrides du channel
  if (channelOverrides) {
    // Retirer les permissions deny
    permissions &= ~channelOverrides.denyPermissions;
    // Ajouter les permissions allow
    permissions |= channelOverrides.allowPermissions;
  }

  return permissions;
}

/**
 * Convertir un nombre en BigInt pour la DB
 */
export function permissionsToBigInt(permissions: bigint): string {
  return permissions.toString();
}

/**
 * Convertir depuis la DB
 */
export function bigIntToPermissions(value: string | number): bigint {
  return BigInt(value);
}

/**
 * Obtenir un résumé lisible des permissions
 */
export function getPermissionNames(permissions: bigint): string[] {
  const names: string[] = [];
  
  for (const [key, value] of Object.entries(PermissionFlags)) {
    if (typeof value === 'bigint' && (permissions & value) !== 0n) {
      names.push(key);
    }
  }
  
  return names;
}

/**
 * Permissions minimales pour créer un serveur
 */
export const SERVER_CREATOR_PERMISSIONS = OWNER_PERMISSIONS;

/**
 * Permissions par défaut pour le rôle @everyone
 */
export const EVERYONE_ROLE_PERMISSIONS = DEFAULT_PERMISSIONS;
