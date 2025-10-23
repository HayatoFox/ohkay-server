import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import { decryptMessage, encryptMessage } from '../utils/crypto';
import { PermissionFlags, hasPermission } from '../utils/permissions-flags';
import { getUserChannelPermissions } from './permissions';
import logger from '../utils/logger';

const router = Router();

// Get all channels (requires serverId in query)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.query.serverId as string);
    const userId = req.user?.id;

    if (!serverId) {
      return res.status(400).json({ error: 'Server ID is required' });
    }

    // Vérifier que l'utilisateur est membre du serveur
    const memberCheck = await dbManager.queryRegistry(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    // Récupérer les channels depuis la DB du serveur
    const result = await dbManager.queryServer(
      serverId,
      'SELECT * FROM channels ORDER BY position ASC',
      []
    );

    // Enrichir avec les usernames depuis auth_db ET filtrer par permission VIEW_CHANNEL
    const channels = await Promise.all(
      result.rows.map(async (channel: any) => {
        // Vérifier si l'utilisateur a VIEW_CHANNEL pour ce channel
        const channelPerms = await getUserChannelPermissions(serverId, channel.id, userId!);
        
        if (!hasPermission(channelPerms, PermissionFlags.VIEW_CHANNEL)) {
          return null; // Pas de permission, ne pas inclure
        }

        const userResult = await dbManager.queryAuth(
          'SELECT username FROM users WHERE id = $1',
          [channel.created_by]
        );
        return {
          ...channel,
          creatorUsername: userResult.rows[0]?.username,
        };
      })
    );

    // Filtrer les channels null (sans permission)
    const visibleChannels = channels.filter(c => c !== null);

    logger.info('Channels fetched', { count: visibleChannels.length, serverId, userId });
    return res.json({ channels: visibleChannels });
  } catch (error: any) {
    logger.error('Error fetching channels', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// Create new channel
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { serverId, name, description, type, position } = req.body;
    const userId = req.user?.id;

    if (!serverId || !name) {
      return res.status(400).json({ error: 'Server ID and channel name are required' });
    }

    if (name.length > 100) {
      return res.status(400).json({ error: 'Channel name too long (max 100 characters)' });
    }

    // Vérifier que l'utilisateur est membre du serveur
    const memberCheck = await dbManager.queryRegistry(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    // Vérifier la permission MANAGE_CHANNELS
    const { getUserPermissions } = await import('./permissions');
    const userPerms = await getUserPermissions(serverId, userId!);
    
    if (!hasPermission(userPerms, PermissionFlags.MANAGE_CHANNELS)) {
      return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
    }

    // Créer le channel dans la DB du serveur
    const result = await dbManager.queryServer(
      serverId,
      'INSERT INTO channels (name, description, type, position, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description || null, type || 'text', position || 0, userId]
    );

    const channel = result.rows[0];
    logger.info('Channel created', { channelId: channel.id, channelName: name, serverId, userId });

    return res.status(201).json({ message: 'Channel created', channel });
  } catch (error: any) {
    logger.error('Error creating channel', { error: error.message });
    return res.status(500).json({ error: 'Failed to create channel' });
  }
});

// Get channel messages
router.get('/:channelId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = parseInt(req.params.channelId);
    const serverId = parseInt(req.query.serverId as string);
    const limit = parseInt(req.query.limit as string) || 50;
    const userId = req.user?.id;

    if (!serverId) {
      return res.status(400).json({ error: 'Server ID is required' });
    }

    // Vérifier que l'utilisateur est membre du serveur
    const memberCheck = await dbManager.queryRegistry(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    // Vérifier les permissions VIEW_CHANNEL et READ_MESSAGE_HISTORY
    const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
    
    if (!hasPermission(channelPerms, PermissionFlags.VIEW_CHANNEL)) {
      return res.status(403).json({ error: 'Missing VIEW_CHANNEL permission' });
    }
    
    if (!hasPermission(channelPerms, PermissionFlags.READ_MESSAGE_HISTORY)) {
      return res.status(403).json({ error: 'Missing READ_MESSAGE_HISTORY permission' });
    }

    // Récupérer la clé de chiffrement du serveur
    const serverResult = await dbManager.queryRegistry(
      'SELECT encryption_key FROM servers WHERE id = $1',
      [serverId]
    );

    if (serverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const serverKey = serverResult.rows[0].encryption_key;

    // Récupérer les messages CHIFFRÉS depuis la DB du serveur
    const result = await dbManager.queryServer(
      serverId,
      `SELECT m.* 
       FROM messages m 
       WHERE m.channel_id = $1 AND m.deleted_at IS NULL 
       ORDER BY m.created_at DESC 
       LIMIT $2`,
      [channelId, limit]
    );

    // Enrichir avec les infos utilisateur ET déchiffrer les messages
    const messages = await Promise.all(
      result.rows.map(async (msg: any) => {
        const userResult = await dbManager.queryAuth(
          `SELECT u.username, p.display_name, p.avatar_url
           FROM users u
           LEFT JOIN user_profiles p ON u.id = p.user_id
           WHERE u.id = $1`,
          [msg.user_id]
        );

        // Déchiffrer le contenu du message
        let decryptedContent = decryptMessage(msg.content, serverKey);
        let attachments = [];

        // Si le message contient des pièces jointes (JSON)
        if (msg.message_type !== 'text') {
          try {
            const parsed = JSON.parse(decryptedContent);
            decryptedContent = parsed.text || '';
            attachments = parsed.attachments || [];
          } catch {
            // Si échec parsing, garder tel quel
          }
        }

        const user = userResult.rows[0] || {};

        return {
          ...msg,
          content: decryptedContent, // Remplacer le contenu chiffré par le déchiffré
          attachments, // Ajouter les pièces jointes si présentes
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
        };
      })
    );

    logger.debug('Messages fetched', { channelId, serverId, count: messages.length });
    return res.json({ messages: messages.reverse() });
  } catch (error: any) {
    logger.error('Error fetching messages', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Modifier un message
router.patch(
  '/:serverId/:channelId/messages/:messageId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const messageId = parseInt(req.params.messageId);
      const userId = req.user?.id;
      const { content } = req.body;

      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Message content cannot be empty' });
      }

      // Récupérer le message
      const msgResult = await dbManager.queryServer(
        serverId,
        'SELECT * FROM messages WHERE id = $1 AND channel_id = $2',
        [messageId, channelId]
      );

      if (msgResult.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const message = msgResult.rows[0];

      // Vérifier : soit c'est son propre message, soit on a MANAGE_MESSAGES
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
      const isOwnMessage = message.user_id === userId;
      const canManage = hasPermission(channelPerms, PermissionFlags.MANAGE_MESSAGES);

      if (!isOwnMessage && !canManage) {
        return res.status(403).json({ error: 'Cannot edit this message' });
      }

      // Récupérer la clé de chiffrement
      const serverResult = await dbManager.queryRegistry(
        'SELECT encryption_key FROM servers WHERE id = $1',
        [serverId]
      );

      const serverKey = serverResult.rows[0].encryption_key;

      // Chiffrer le nouveau contenu
      const encryptedContent = encryptMessage(content, serverKey);

      // Mettre à jour le message
      await dbManager.queryServer(
        serverId,
        'UPDATE messages SET content = $1, is_edited = TRUE, edited_at = NOW() WHERE id = $2',
        [encryptedContent, messageId]
      );

      logger.info('Message edited', { messageId, userId, serverId, channelId });

      return res.json({ message: 'Message updated' });
    } catch (error: any) {
      logger.error('Error editing message', { error: error.message });
      return res.status(500).json({ error: 'Failed to edit message' });
    }
  }
);

// Supprimer un message
router.delete(
  '/:serverId/:channelId/messages/:messageId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const messageId = parseInt(req.params.messageId);
      const userId = req.user?.id;

      // Récupérer le message
      const msgResult = await dbManager.queryServer(
        serverId,
        'SELECT * FROM messages WHERE id = $1 AND channel_id = $2',
        [messageId, channelId]
      );

      if (msgResult.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const message = msgResult.rows[0];

      // Vérifier : soit c'est son propre message, soit on a MANAGE_MESSAGES
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
      const isOwnMessage = message.user_id === userId;
      const canManage = hasPermission(channelPerms, PermissionFlags.MANAGE_MESSAGES);

      if (!isOwnMessage && !canManage) {
        return res.status(403).json({ error: 'Cannot delete this message' });
      }

      // Soft delete
      await dbManager.queryServer(
        serverId,
        'UPDATE messages SET deleted_at = NOW() WHERE id = $1',
        [messageId]
      );

      logger.info('Message deleted', { messageId, userId, serverId, channelId });

      return res.json({ message: 'Message deleted' });
    } catch (error: any) {
      logger.error('Error deleting message', { error: error.message });
      return res.status(500).json({ error: 'Failed to delete message' });
    }
  }
);

// Update channel (name, description, position)
router.patch(
  '/:serverId/channels/:channelId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const userId = req.user?.id;
      const { name, description, position } = req.body;

      // Vérifier la permission MANAGE_CHANNELS
      const { getUserPermissions } = await import('./permissions');
      const userPerms = await getUserPermissions(serverId, userId!);
      
      if (!hasPermission(userPerms, PermissionFlags.MANAGE_CHANNELS)) {
        return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
      }

      // Vérifier que le channel existe
      const channelCheck = await dbManager.queryServer(
        serverId,
        'SELECT * FROM channels WHERE id = $1',
        [channelId]
      );

      if (channelCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // Construire la requête de mise à jour dynamiquement
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        values.push(name);
      }
      if (description !== undefined) {
        updates.push(`description = $${paramCount++}`);
        values.push(description);
      }
      if (position !== undefined) {
        updates.push(`position = $${paramCount++}`);
        values.push(position);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(channelId);

      const result = await dbManager.queryServer(
        serverId,
        `UPDATE channels SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );

      const channel = result.rows[0];
      logger.info('Channel updated', { channelId, serverId, userId, updates: Object.keys(req.body) });

      return res.json({ message: 'Channel updated', channel });
    } catch (error: any) {
      logger.error('Error updating channel', { error: error.message });
      return res.status(500).json({ error: 'Failed to update channel' });
    }
  }
);

// Delete channel
router.delete(
  '/:serverId/channels/:channelId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const userId = req.user?.id;

      // Vérifier la permission MANAGE_CHANNELS
      const { getUserPermissions } = await import('./permissions');
      const userPerms = await getUserPermissions(serverId, userId!);
      
      if (!hasPermission(userPerms, PermissionFlags.MANAGE_CHANNELS)) {
        return res.status(403).json({ error: 'Missing MANAGE_CHANNELS permission' });
      }

      // Vérifier que le channel existe
      const channelCheck = await dbManager.queryServer(
        serverId,
        'SELECT * FROM channels WHERE id = $1',
        [channelId]
      );

      if (channelCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // Supprimer le channel (CASCADE supprimera les messages, permissions, etc.)
      await dbManager.queryServer(
        serverId,
        'DELETE FROM channels WHERE id = $1',
        [channelId]
      );

      logger.info('Channel deleted', { channelId, serverId, userId });

      return res.json({ message: 'Channel deleted' });
    } catch (error: any) {
      logger.error('Error deleting channel', { error: error.message });
      return res.status(500).json({ error: 'Failed to delete channel' });
    }
  }
);

export default router;
