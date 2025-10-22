import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { verifyToken } from '../utils/auth';
import logger from '../utils/logger';

const router = Router();

// Middleware to verify JWT token
const authenticateToken = (req: Request, res: Response, next: Function): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(403).json({ error: 'Invalid or expired token' });
    return;
  }

  (req as any).user = decoded;
  next();
};

// Get all channels
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT c.*, u.username as creator_username FROM channels c LEFT JOIN users u ON c.created_by = u.id ORDER BY c.created_at'
    );

    logger.info('Channels fetched', { count: result.rows.length, userId: (req as any).user.userId });
    res.json({ channels: result.rows });
  } catch (error: any) {
    logger.error('Error fetching channels', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// Create new channel (now requires serverId)
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { serverId, name, description, type, position } = req.body;
    const userId = (req as any).user.userId;

    if (!serverId || !name) {
      return res.status(400).json({ error: 'Server ID and channel name are required' });
    }

    // Vérifier que l'utilisateur est membre du serveur
    const memberCheck = await query(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    // Vérifier ownership pour créer des channels (simplif ié pour l'instant)
    const serverCheck = await query('SELECT * FROM servers WHERE id = $1 AND owner_id = $2', [serverId, userId]);
    
    if (serverCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only server owner can create channels' });
    }

    const result = await query(
      'INSERT INTO channels (server_id, name, description, type, position, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [serverId, name, description || null, type || 'text', position || 0, userId]
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
router.get('/:channelId/messages', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await query(
      `SELECT m.*, u.username, u.display_name, u.avatar_url 
       FROM messages m 
       JOIN users u ON m.user_id = u.id 
       WHERE m.channel_id = $1 AND m.deleted_at IS NULL 
       ORDER BY m.created_at DESC 
       LIMIT $2`,
      [channelId, limit]
    );

    logger.debug('Messages fetched', { channelId, count: result.rows.length });
    res.json({ messages: result.rows.reverse() });
  } catch (error: any) {
    logger.error('Error fetching messages', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export default router;
