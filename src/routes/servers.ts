import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import { generateServerKey } from '../utils/crypto';
import { DEFAULT_PERMISSIONS, permissionsToBigInt } from '../utils/permissions-flags';
import logger from '../utils/logger';

const router = Router();

// Obtenir tous les serveurs de l'utilisateur
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    // Récupérer les serveurs depuis registry_db avec leurs membres
    const result = await dbManager.queryRegistry(
      `SELECT s.id, s.name, s.description, s.icon_url, s.owner_id, s.is_public, 
              s.created_at, sm.joined_at as member_since
       FROM servers s
       INNER JOIN server_members sm ON s.id = sm.server_id
       WHERE sm.user_id = $1 AND s.status = 'active'
       ORDER BY sm.joined_at ASC`,
      [userId]
    );

    // Enrichir avec les infos du propriétaire depuis auth_db
    const servers = await Promise.all(
      result.rows.map(async (server: any) => {
        const ownerResult = await dbManager.queryAuth(
          'SELECT username FROM users WHERE id = $1',
          [server.owner_id]
        );
        return {
          ...server,
          ownerUsername: ownerResult.rows[0]?.username
        };
      })
    );

    logger.info('Servers fetched', { count: servers.length, userId });
    return res.json({ servers });
  } catch (error: any) {
    logger.error('Error fetching servers', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// Créer un nouveau serveur
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    const userId = req.user?.id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Server name is required' });
    }

    if (name.length > 100) {
      return res.status(400).json({ error: 'Server name too long (max 100 characters)' });
    }

    if (description && description.length > 500) {
      return res.status(400).json({ error: 'Server description too long (max 500 characters)' });
    }

    // Générer nom de DB unique pour ce serveur
    const dbName = `ohkay_server_${Date.now()}`;
    const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Générer une clé de chiffrement unique pour ce serveur
    const serverEncryptionKey = generateServerKey();

    // Chiffrer le mot de passe DB avant de le stocker
    const encryptedPassword = dbManager.encryptPassword(process.env.DB_PASSWORD!);

    // Créer l'entrée dans le registre
    const serverResult = await dbManager.queryRegistry(
      `INSERT INTO servers (name, description, owner_id, invite_code, db_name, db_host, db_port, db_user, db_password_encrypted, encryption_key) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING *`,
      [
        name, 
        description || null, 
        userId, 
        inviteCode,
        dbName,
        process.env.DB_HOST || 'localhost', // TODO: Support multi-host
        5432,
        process.env.DB_USER,
        encryptedPassword,
        serverEncryptionKey
      ]
    );

    const server = serverResult.rows[0];

    // Ajouter le créateur comme membre dans registry
    await dbManager.queryRegistry(
      'INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)',
      [server.id, userId]
    );

    // Créer physiquement la base de données PostgreSQL pour ce serveur
    const serverId = server.id;
    
    try {
      await dbManager.createServerDatabase(dbName, process.env.DB_USER!);
      logger.info('Server database created successfully', { serverId, dbName });
    } catch (error: any) {
      // Rollback : supprimer l'entrée dans le registre si la création de DB échoue
      logger.error('Failed to create server database, rolling back', { 
        serverId, 
        dbName, 
        error: error.message 
      });
      
      await dbManager.queryRegistry('DELETE FROM server_members WHERE server_id = $1', [serverId]);
      await dbManager.queryRegistry('DELETE FROM servers WHERE id = $1', [serverId]);
      
      return res.status(500).json({ 
        error: 'Failed to create server database',
        details: error.message 
      });
    }

    // Créer le rôle @everyone dans la DB du serveur avec permissions par défaut
    await dbManager.queryServer(
      serverId,
      'INSERT INTO roles (name, permissions, position, is_default, color) VALUES ($1, $2, $3, $4, $5)',
      ['@everyone', permissionsToBigInt(DEFAULT_PERMISSIONS), 0, true, null]
    );

    // Créer le channel général
    await dbManager.queryServer(
      serverId,
      'INSERT INTO channels (name, description, type, position, created_by) VALUES ($1, $2, $3, $4, $5)',
      ['general', 'Discussion générale', 'text', 0, userId]
    );

    logger.info('Server created successfully', { 
      serverId: server.id, 
      serverName: name, 
      userId, 
      dbName,
      inviteCode 
    });

    return res.status(201).json({ 
      message: 'Server created successfully', 
      server: {
        ...server,
        // Ne pas exposer les infos sensibles de la DB
        db_password_encrypted: undefined,
      }
    });
  } catch (error: any) {
    logger.error('Error creating server', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to create server' });
  }
});

// Obtenir les détails d'un serveur
router.get('/:serverId', authenticateToken, checkServerMembership, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.params.serverId);

    const result = await dbManager.queryRegistry(
      'SELECT * FROM servers WHERE id = $1 AND status = $2',
      [serverId, 'active']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const server = result.rows[0];

    // Enrichir avec username du propriétaire
    const ownerResult = await dbManager.queryAuth(
      'SELECT username FROM users WHERE id = $1',
      [server.owner_id]
    );

    return res.json({ 
      server: {
        ...server,
        ownerUsername: ownerResult.rows[0]?.username
      }
    });
  } catch (error: any) {
    logger.error('Error fetching server', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch server' });
  }
});

// Obtenir les channels d'un serveur
router.get('/:serverId/channels', authenticateToken, checkServerMembership, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.params.serverId);
    const userId = req.user?.id;

    // Récupérer channels depuis la DB du serveur
    const result = await dbManager.queryServer(
      serverId,
      'SELECT * FROM channels ORDER BY position ASC',
      []
    );

    // Enrichir avec username du créateur
    const channels = await Promise.all(
      result.rows.map(async (channel: any) => {
        const userResult = await dbManager.queryAuth(
          'SELECT username FROM users WHERE id = $1',
          [channel.created_by]
        );
        return {
          ...channel,
          creatorUsername: userResult.rows[0]?.username
        };
      })
    );

    logger.info('Server channels fetched', { serverId, count: channels.length, userId });
    return res.json({ channels });
  } catch (error: any) {
    logger.error('Error fetching server channels', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// Modifier les paramètres d'un serveur (MANAGE_GUILD)
router.patch('/:serverId', authenticateToken, checkServerMembership, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.params.serverId);
    const userId = req.user?.id;
    const { name, description, icon_url, is_public } = req.body;

    // Vérifier permission MANAGE_GUILD
    const { getUserPermissions } = await import('./permissions');
    const { PermissionFlags, hasPermission } = await import('../utils/permissions-flags');
    
    const userPerms = await getUserPermissions(serverId, userId!);
    if (!hasPermission(userPerms, PermissionFlags.MANAGE_GUILD)) {
      return res.status(403).json({ error: 'Missing MANAGE_GUILD permission' });
    }

    // Validation
    if (name !== undefined) {
      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Server name cannot be empty' });
      }
      if (name.length > 100) {
        return res.status(400).json({ error: 'Server name too long' });
      }
    }

    if (description !== undefined && description && description.length > 500) {
      return res.status(400).json({ error: 'Description too long' });
    }

    // Construire la query dynamiquement
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      values.push(description);
      paramCount++;
    }

    if (icon_url !== undefined) {
      updates.push(`icon_url = $${paramCount}`);
      values.push(icon_url);
      paramCount++;
    }

    if (is_public !== undefined) {
      updates.push(`is_public = $${paramCount}`);
      values.push(is_public);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(serverId);
    const query = `UPDATE servers SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

    const result = await dbManager.queryRegistry(query, values);

    logger.info('Server updated', { serverId, userId, updates: Object.keys(req.body) });

    return res.json({ server: result.rows[0] });
  } catch (error: any) {
    logger.error('Error updating server', { error: error.message });
    return res.status(500).json({ error: 'Failed to update server' });
  }
});

// Obtenir les membres d'un serveur
router.get('/:serverId/members', authenticateToken, checkServerMembership, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.params.serverId);

    // Récupérer les membres depuis registry
    const membersResult = await dbManager.queryRegistry(
      'SELECT user_id, nickname, joined_at FROM server_members WHERE server_id = $1 ORDER BY joined_at ASC',
      [serverId]
    );

    // Enrichir avec les infos utilisateur depuis auth_db
    const members = await Promise.all(
      membersResult.rows.map(async (member: any) => {
        const userResult = await dbManager.queryAuth(
          `SELECT u.id, u.username, u.status, u.last_seen, p.display_name, p.avatar_url
           FROM users u
           LEFT JOIN user_profiles p ON u.id = p.user_id
           WHERE u.id = $1`,
          [member.user_id]
        );

        const user = userResult.rows[0] || {};

        return {
          id: user.id,
          username: user.username,
          displayName: user.display_name || user.username,
          avatarUrl: user.avatar_url,
          status: user.status,
          lastSeen: user.last_seen,
          nickname: member.nickname,
          joinedAt: member.joined_at
        };
      })
    );

    return res.json({ members });
  } catch (error: any) {
    logger.error('Error fetching server members', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// Rejoindre un serveur via code d'invitation
router.post('/join/:inviteCode', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { inviteCode } = req.params;
    const userId = req.user?.id;

    // Vérifier l'invitation dans la DB du serveur
    // Pour simplifier, chercher d'abord le serveur par invite_code dans registry
    const serverResult = await dbManager.queryRegistry(
      'SELECT id FROM servers WHERE invite_code = $1 AND status = $2',
      [inviteCode, 'active']
    );

    if (serverResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const serverId = serverResult.rows[0].id;

    // Vérifier si déjà membre
    const memberCheck = await dbManager.queryRegistry(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Already a member of this server' });
    }

    // Ajouter comme membre dans registry
    await dbManager.queryRegistry(
      'INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)',
      [serverId, userId]
    );

    // Récupérer les infos du serveur
    const finalServerResult = await dbManager.queryRegistry(
      'SELECT * FROM servers WHERE id = $1',
      [serverId]
    );

    logger.info('User joined server via invite', { serverId, userId, inviteCode });

    return res.json({ message: 'Joined server successfully', server: finalServerResult.rows[0] });
  } catch (error: any) {
    logger.error('Error joining server', { error: error.message });
    return res.status(500).json({ error: 'Failed to join server' });
  }
});

// Créer une invitation pour un serveur
router.post('/:serverId/invites', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.params.serverId);
    const userId = req.user?.id;
    const { maxUses, expiresInHours } = req.body;

    // Vérifier ownership ou permissions
    const serverResult = await dbManager.queryRegistry(
      'SELECT * FROM servers WHERE id = $1',
      [serverId]
    );
    
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

    // Créer l'invitation dans la DB du serveur
    const result = await dbManager.queryServer(
      serverId,
      'INSERT INTO invites (code, created_by, max_uses, expires_at) VALUES ($1, $2, $3, $4) RETURNING *',
      [code, userId, maxUses || 0, expiresAt]
    );

    logger.info('Invite created', { serverId, code, userId });

    return res.status(201).json({ invite: result.rows[0] });
  } catch (error: any) {
    logger.error('Error creating invite', { error: error.message });
    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

export default router;
