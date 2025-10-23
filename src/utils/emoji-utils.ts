import { dbManager } from './database';
import logger from './logger';

/**
 * Extraire les IDs d'emojis custom d'un message
 * Format: <:emoji_name:serverId:emojiId>
 */
export function extractCustomEmojis(content: string): Array<{ serverId: number; emojiId: number; name: string }> {
  const emojiRegex = /<:([a-zA-Z0-9_]+):(\d+):(\d+)>/g;
  const emojis: Array<{ serverId: number; emojiId: number; name: string }> = [];
  
  let match;
  while ((match = emojiRegex.exec(content)) !== null) {
    emojis.push({
      name: match[1],
      serverId: parseInt(match[2]),
      emojiId: parseInt(match[3]),
    });
  }
  
  return emojis;
}

/**
 * Vérifier si un utilisateur peut utiliser les emojis d'un message
 * Retourne true si autorisé, false sinon
 */
export async function canUseEmojis(
  userId: number,
  targetServerId: number,
  emojis: Array<{ serverId: number; emojiId: number; name: string }>,
  hasUseExternalEmojis: boolean
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    for (const emoji of emojis) {
      // Si l'emoji vient du serveur actuel, toujours OK
      if (emoji.serverId === targetServerId) {
        continue;
      }

      // Si emoji externe, vérifier permission USE_EXTERNAL_EMOJIS
      if (!hasUseExternalEmojis) {
        return {
          allowed: false,
          reason: `Missing USE_EXTERNAL_EMOJIS permission to use :${emoji.name}:`,
        };
      }

      // Vérifier que l'emoji existe dans le serveur source
      const emojiCheck = await dbManager.queryServer(
        emoji.serverId,
        'SELECT * FROM emojis WHERE id = $1',
        [emoji.emojiId]
      );

      if (emojiCheck.rows.length === 0) {
        return {
          allowed: false,
          reason: `Emoji :${emoji.name}: not found`,
        };
      }

      // Vérifier que l'utilisateur est membre du serveur source
      const memberCheck = await dbManager.queryRegistry(
        'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
        [emoji.serverId, userId]
      );

      if (memberCheck.rows.length === 0) {
        return {
          allowed: false,
          reason: `You are not a member of the server containing :${emoji.name}:`,
        };
      }
    }

    return { allowed: true };
  } catch (error: any) {
    logger.error('Error checking emoji permissions', { error: error.message });
    return {
      allowed: false,
      reason: 'Failed to verify emoji permissions',
    };
  }
}

/**
 * Remplacer les emojis custom par leur représentation HTML/markdown
 * Pour affichage côté client
 */
export function renderCustomEmojis(content: string, emojiData: Map<string, { imageUrl: string; animated: boolean }>): string {
  const emojiRegex = /<:([a-zA-Z0-9_]+):(\d+):(\d+)>/g;
  
  return content.replace(emojiRegex, (match, name, serverId, emojiId) => {
    const key = `${serverId}:${emojiId}`;
    const emoji = emojiData.get(key);
    
    if (emoji) {
      return `<img src="${emoji.imageUrl}" alt=":${name}:" class="custom-emoji" data-animated="${emoji.animated}" />`;
    }
    
    return match; // Garder tel quel si pas trouvé
  });
}
