import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { verifyToken } from '../utils/auth';
import logger from '../utils/logger';

const router = Router();

// Middleware d'authentification
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

// Obtenir tous les serveurs de l'utilisateur
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const result = await query(
      `SELECT s.*, u.username as owner_username,
              sm.joined_at as member_since
       FROM servers s
       LEFT JOIN users u ON s.owner_id = u.id
       INNER JOIN server_members sm ON s.id = sm.server_id
       WHERE sm.user_id = $1
       ORDER BY sm.joined_at ASC`,
      [userId]
    );

    logger.info('Servers fetched', { count: result.rows.length, userId });
    return res.json({ servers: result.rows });
  } catch (error: any) {
    logger.error('Error fetching servers', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// Créer un nouveau serveur
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const userId = (req as any).user.userId;

    if (!name) {
      return res.status(400).json({ error: 'Server name is required' });
    }

    // Créer le serveur
    const serverResult = await query(
      'INSERT INTO servers (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *',
      [name, description || null, userId]
    );

    const server = serverResult.rows[0];

    // Ajouter le créateur comme membre
    await query(
      'INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)',
      [server.id, userId]
    );

    // Créer le rôle @everyone
    await query(
      'INSERT INTO roles (server_id, name, permissions, position) VALUES ($1, $2, $3, $4)',
      [server.id, '@everyone', 0, 0]
    );

    // Créer le channel général
    await query(
      'INSERT INTO channels (server_id, name, description, type, position, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [server.id, 'general', 'Discussion générale', 'text', 0, userId]
    );

    logger.info('Server created', { serverId: server.id, serverName: name, userId });

    return res.status(201).json({ message: 'Server created', server });
  } catch (error: any) {
    logger.error('Error creating server', { error: error.message });
    return res.status(500).json({ error: 'Failed to create server' });
  }
});

// Obtenir les détails d'un serveur
router.get('/:serverId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const userId = (req as any).user.userId;

    // Vérifier que l'utilisateur est membre
    const memberCheck = await query(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    const result = await query(
      `SELECT s.*, u.username as owner_username
       FROM servers s
       LEFT JOIN users u ON s.owner_id = u.id
       WHERE s.id = $1`,
      [serverId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Server not found' });
    }

    return res.json({ server: result.rows[0] });
  } catch (error: any) {
    logger.error('Error fetching server', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch server' });
  }
});

// Obtenir les channels d'un serveur
router.get('/:serverId/channels', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const userId = (req as any).user.userId;

    // Vérifier membership
    const memberCheck = await query(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    const result = await query(
      `SELECT c.*, u.username as creator_username
       FROM channels c
       LEFT JOIN users u ON c.created_by = u.id
       WHERE c.server_id = $1
       ORDER BY c.position ASC`,
      [serverId]
    );

    logger.info('Server channels fetched', { serverId, count: result.rows.length, userId });
    return res.json({ channels: result.rows });
  } catch (error: any) {
    logger.error('Error fetching server channels', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// Obtenir les membres d'un serveur
router.get('/:serverId/members', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const userId = (req as any).user.userId;

    // Vérifier membership
    const memberCheck = await query(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status,
              sm.nickname, sm.joined_at
       FROM users u
       INNER JOIN server_members sm ON u.id = sm.user_id
       WHERE sm.server_id = $1
       ORDER BY u.username ASC`,
      [serverId]
    );

    return res.json({ members: result.rows });
  } catch (error: any) {
    logger.error('Error fetching server members', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// Rejoindre un serveur via code d'invitation
router.post('/join/:inviteCode', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { inviteCode } = req.params;
    const userId = (req as any).user.userId;

    // Vérifier l'invitation
    const inviteResult = await query(
      `SELECT * FROM invites 
       WHERE code = $1 
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (max_uses = 0 OR current_uses < max_uses)`,
      [inviteCode]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired invite code' });
    }

    const invite = inviteResult.rows[0];

    // Vérifier si déjà membre
    const memberCheck = await query(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [invite.server_id, userId]
    );

    if (memberCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Already a member of this server' });
    }

    // Ajouter comme membre
    await query(
      'INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)',
      [invite.server_id, userId]
    );

    // Incrémenter le compteur d'utilisations
    await query(
      'UPDATE invites SET current_uses = current_uses + 1 WHERE id = $1',
      [invite.id]
    );

    // Récupérer les infos du serveur
    const serverResult = await query('SELECT * FROM servers WHERE id = $1', [invite.server_id]);

    logger.info('User joined server via invite', { serverId: invite.server_id, userId, inviteCode });

    return res.json({ message: 'Joined server successfully', server: serverResult.rows[0] });
  } catch (error: any) {
    logger.error('Error joining server', { error: error.message });
    return res.status(500).json({ error: 'Failed to join server' });
  }
});

// Créer une invitation pour un serveur
router.post('/:serverId/invites', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const userId = (req as any).user.userId;
    const { maxUses, expiresInHours } = req.body;

    // Vérifier ownership ou permissions
    const serverResult = await query('SELECT * FROM servers WHERE id = $1', [serverId]);
    
    if (serverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const server = serverResult.rows[0];
    
    if (server.owner_id !== userId) {
      return res.status(403).json({ error: 'Only server owner can create invites' });
    }

    // Générer code unique
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    const expiresAt = expiresInHours 
      ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
      : null;

    const result = await query(
      'INSERT INTO invites (server_id, code, created_by, max_uses, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [serverId, code, userId, maxUses || 0, expiresAt]
    );

    logger.info('Invite created', { serverId, code, userId });

    return res.status(201).json({ invite: result.rows[0] });
  } catch (error: any) {
    logger.error('Error creating invite', { error: error.message });
    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

export default router;
