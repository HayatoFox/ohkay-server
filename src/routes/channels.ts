import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
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

    // Enrichir avec les usernames depuis auth_db
    const channels = await Promise.all(
      result.rows.map(async (channel: any) => {
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

    logger.info('Channels fetched', { count: channels.length, serverId, userId });
    return res.json({ channels });
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

    // Vérifier ownership pour créer des channels
    const serverCheck = await dbManager.queryRegistry(
      'SELECT * FROM servers WHERE id = $1 AND owner_id = $2',
      [serverId, userId]
    );
    
    if (serverCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only server owner can create channels' });
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

    // Récupérer les messages depuis la DB du serveur
    const result = await dbManager.queryServer(
      serverId,
      `SELECT m.* 
       FROM messages m 
       WHERE m.channel_id = $1 AND m.deleted_at IS NULL 
       ORDER BY m.created_at DESC 
       LIMIT $2`,
      [channelId, limit]
    );

    // Enrichir avec les infos utilisateur depuis auth_db
    const messages = await Promise.all(
      result.rows.map(async (msg: any) => {
        const userResult = await dbManager.queryAuth(
          `SELECT u.username, p.display_name, p.avatar_url
           FROM users u
           LEFT JOIN user_profiles p ON u.id = p.user_id
           WHERE u.id = $1`,
          [msg.user_id]
        );

        const user = userResult.rows[0] || {};

        return {
          ...msg,
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

export default router;
