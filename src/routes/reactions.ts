import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import { PermissionFlags, hasPermission } from '../utils/permissions-flags';
import { getUserChannelPermissions } from './permissions';
import logger from '../utils/logger';

const router = Router();

// Ajouter une réaction à un message (ADD_REACTIONS)
router.post(
  '/:serverId/channels/:channelId/messages/:messageId/reactions',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const messageId = parseInt(req.params.messageId);
      const userId = req.user?.id;
      const { emoji } = req.body;

      if (!emoji || emoji.trim().length === 0) {
        return res.status(400).json({ error: 'Emoji is required' });
      }

      // Vérifier permission ADD_REACTIONS
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
      if (!hasPermission(channelPerms, PermissionFlags.ADD_REACTIONS)) {
        return res.status(403).json({ error: 'Missing ADD_REACTIONS permission' });
      }

      // Vérifier que le message existe
      const msgCheck = await dbManager.queryServer(
        serverId,
        'SELECT * FROM messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL',
        [messageId, channelId]
      );

      if (msgCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Si c'est un emoji custom externe, vérifier USE_EXTERNAL_EMOJIS
      if (emoji.startsWith('<:')) {
        const match = emoji.match(/<:([a-zA-Z0-9_]+):(\d+):(\d+)>/);
        if (match) {
          const emojiServerId = parseInt(match[2]);
          
          if (emojiServerId !== serverId) {
            if (!hasPermission(channelPerms, PermissionFlags.USE_EXTERNAL_EMOJIS)) {
              return res.status(403).json({ error: 'Missing USE_EXTERNAL_EMOJIS permission' });
            }

            // Vérifier que l'utilisateur est membre du serveur de l'emoji
            const memberCheck = await dbManager.queryRegistry(
              'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
              [emojiServerId, userId]
            );

            if (memberCheck.rows.length === 0) {
              return res.status(403).json({ error: 'You are not a member of the server containing this emoji' });
            }
          }
        }
      }

      // Ajouter la réaction (ou ignorer si existe déjà)
      await dbManager.queryServer(
        serverId,
        `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [messageId, userId, emoji]
      );

      logger.info('Reaction added', { serverId, channelId, messageId, userId, emoji });

      return res.json({ message: 'Reaction added' });
    } catch (error: any) {
      logger.error('Error adding reaction', { error: error.message });
      return res.status(500).json({ error: 'Failed to add reaction' });
    }
  }
);

// Retirer une réaction
router.delete(
  '/:serverId/channels/:channelId/messages/:messageId/reactions/:emoji',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const messageId = parseInt(req.params.messageId);
      const userId = req.user?.id;
      const emoji = decodeURIComponent(req.params.emoji);

      // Supprimer la réaction
      const result = await dbManager.queryServer(
        serverId,
        'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
        [messageId, userId, emoji]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Reaction not found' });
      }

      logger.info('Reaction removed', { serverId, channelId, messageId, userId, emoji });

      return res.json({ message: 'Reaction removed' });
    } catch (error: any) {
      logger.error('Error removing reaction', { error: error.message });
      return res.status(500).json({ error: 'Failed to remove reaction' });
    }
  }
);

// Obtenir toutes les réactions d'un message
router.get(
  '/:serverId/channels/:channelId/messages/:messageId/reactions',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const messageId = parseInt(req.params.messageId);

      const result = await dbManager.queryServer(
        serverId,
        `SELECT emoji, user_id, created_at 
         FROM message_reactions 
         WHERE message_id = $1 
         ORDER BY created_at ASC`,
        [messageId]
      );

      // Grouper par emoji
      const reactionsByEmoji: { [key: string]: any[] } = {};
      
      for (const reaction of result.rows) {
        if (!reactionsByEmoji[reaction.emoji]) {
          reactionsByEmoji[reaction.emoji] = [];
        }
        reactionsByEmoji[reaction.emoji].push({
          userId: reaction.user_id,
          createdAt: reaction.created_at,
        });
      }

      // Enrichir avec usernames
      const reactions = await Promise.all(
        Object.entries(reactionsByEmoji).map(async ([emoji, users]) => {
          const enrichedUsers = await Promise.all(
            users.map(async (user: any) => {
              const userResult = await dbManager.queryAuth(
                'SELECT username FROM users WHERE id = $1',
                [user.userId]
              );
              return {
                ...user,
                username: userResult.rows[0]?.username,
              };
            })
          );

          return {
            emoji,
            count: enrichedUsers.length,
            users: enrichedUsers,
          };
        })
      );

      return res.json({ reactions });
    } catch (error: any) {
      logger.error('Error fetching reactions', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch reactions' });
    }
  }
);

// Retirer toutes les réactions d'un message (MANAGE_MESSAGES)
router.delete(
  '/:serverId/channels/:channelId/messages/:messageId/reactions',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const messageId = parseInt(req.params.messageId);
      const userId = req.user?.id;

      // Vérifier permission MANAGE_MESSAGES
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
      if (!hasPermission(channelPerms, PermissionFlags.MANAGE_MESSAGES)) {
        return res.status(403).json({ error: 'Missing MANAGE_MESSAGES permission' });
      }

      // Supprimer toutes les réactions
      await dbManager.queryServer(
        serverId,
        'DELETE FROM message_reactions WHERE message_id = $1',
        [messageId]
      );

      logger.info('All reactions removed', { serverId, channelId, messageId, userId });

      return res.json({ message: 'All reactions removed' });
    } catch (error: any) {
      logger.error('Error removing all reactions', { error: error.message });
      return res.status(500).json({ error: 'Failed to remove reactions' });
    }
  }
);

export default router;
