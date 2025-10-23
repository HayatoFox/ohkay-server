import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import { PermissionFlags, hasPermission } from '../utils/permissions-flags';
import { getUserPermissions } from './permissions';
import logger from '../utils/logger';

const router = Router();

/**
 * Créer un code d'invitation pour un serveur
 * POST /api/servers/:serverId/invites
 * Seuls les membres peuvent créer des invitations
 */
router.post('/:serverId/invites', authenticateToken, checkServerMembership, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.params.serverId);
    const userId = req.user?.id;
    const { maxUses = 0, expiresInHours } = req.body;

    // Vérifier la permission CREATE_INSTANT_INVITE
    const userPerms = await getUserPermissions(serverId, userId!);
    if (!hasPermission(userPerms, PermissionFlags.CREATE_INSTANT_INVITE)) {
      return res.status(403).json({ error: 'Missing CREATE_INSTANT_INVITE permission' });
    }

    // Calculer la date d'expiration
    let expiresAt = null;
    if (expiresInHours && expiresInHours > 0) {
      expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiresInHours);
    }

    // Générer le code d'invitation (8 caractères alphanumériques)
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Insérer dans la DB du serveur
    const result = await dbManager.queryServer(
      serverId,
      `INSERT INTO invites (code, created_by, max_uses, current_uses, expires_at)
       VALUES ($1, $2, $3, 0, $4)
       RETURNING id, code, max_uses, current_uses, expires_at, created_at`,
      [code, userId, maxUses, expiresAt]
    );

    const invite = result.rows[0];

    logger.info('Invite created', { 
      serverId, 
      userId, 
      inviteCode: code,
      maxUses,
      expiresAt 
    });

    return res.status(201).json({
      message: 'Invite created successfully',
      invite: {
        ...invite,
        inviteUrl: `ohkay://join/${code}` // Format pour deep linking
      }
    });
  } catch (error: any) {
    logger.error('Error creating invite', { 
      error: error.message,
      serverId: req.params.serverId 
    });
    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

/**
 * Obtenir toutes les invitations d'un serveur
 * GET /api/servers/:serverId/invites
 */
router.get('/:serverId/invites', authenticateToken, checkServerMembership, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.params.serverId);

    const result = await dbManager.queryServer(
      serverId,
      `SELECT i.*, u.username as creator_username
       FROM invites i
       LEFT JOIN LATERAL (
         SELECT username FROM users WHERE id = i.created_by
       ) u ON true
       ORDER BY i.created_at DESC`,
      []
    );

    // Enrichir avec les infos utilisateur depuis auth_db
    const invites = await Promise.all(
      result.rows.map(async (invite: any) => {
        const userResult = await dbManager.queryAuth(
          'SELECT username FROM users WHERE id = $1',
          [invite.created_by]
        );

        return {
          ...invite,
          creatorUsername: userResult.rows[0]?.username,
          isExpired: invite.expires_at && new Date(invite.expires_at) < new Date(),
          isMaxedOut: invite.max_uses > 0 && invite.current_uses >= invite.max_uses
        };
      })
    );

    return res.json({ invites });
  } catch (error: any) {
    logger.error('Error fetching invites', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

/**
 * Rejoindre un serveur avec un code d'invitation
 * POST /api/invites/join
 * Body: { inviteCode: string }
 */
router.post('/join', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { inviteCode } = req.body;
    const userId = req.user?.id;

    if (!inviteCode || typeof inviteCode !== 'string') {
      return res.status(400).json({ error: 'Invite code is required' });
    }

    // 1. Trouver le serveur correspondant au code
    // On doit chercher dans registry_db pour trouver quel serveur a ce code
    const serverResult = await dbManager.queryRegistry(
      'SELECT id, name, db_name FROM servers WHERE invite_code = $1 AND status = $2',
      [inviteCode.toUpperCase(), 'active']
    );

    if (serverResult.rows.length === 0) {
      logger.warn('Invalid invite code used', { inviteCode, userId });
      return res.status(404).json({ error: 'Invalid or expired invite code' });
    }

    const server = serverResult.rows[0];
    const serverId = server.id;

    // 2. Vérifier si l'utilisateur n'est pas déjà membre
    const existingMember = await dbManager.queryRegistry(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (existingMember.rows.length > 0) {
      return res.status(400).json({ error: 'You are already a member of this server' });
    }

    // 3. Vérifier si le code d'invitation existe dans la DB du serveur
    const inviteResult = await dbManager.queryServer(
      serverId,
      `SELECT * FROM invites WHERE code = $1`,
      [inviteCode.toUpperCase()]
    );

    if (inviteResult.rows.length === 0) {
      logger.warn('Invite code not found in server DB', { inviteCode, serverId });
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const invite = inviteResult.rows[0];

    // 4. Valider l'invitation
    // Vérifier expiration
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invite has expired' });
    }

    // Vérifier max uses
    if (invite.max_uses > 0 && invite.current_uses >= invite.max_uses) {
      return res.status(400).json({ error: 'This invite has reached its maximum uses' });
    }

    // 5. Ajouter l'utilisateur comme membre dans registry_db
    await dbManager.queryRegistry(
      'INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)',
      [serverId, userId]
    );

    // 6. Incrémenter current_uses dans la DB du serveur
    await dbManager.queryServer(
      serverId,
      'UPDATE invites SET current_uses = current_uses + 1 WHERE id = $1',
      [invite.id]
    );

    // 7. Logger dans audit_log du serveur
    await dbManager.queryServer(
      serverId,
      `INSERT INTO audit_log (action, user_id, details)
       VALUES ($1, $2, $3)`,
      ['member_joined', userId, JSON.stringify({ inviteCode, inviteId: invite.id })]
    );

    logger.info('User joined server via invite', { 
      userId, 
      serverId, 
      serverName: server.name,
      inviteCode 
    });

    return res.json({
      message: 'Successfully joined server',
      server: {
        id: serverId,
        name: server.name
      }
    });
  } catch (error: any) {
    logger.error('Error joining server', { 
      error: error.message,
      inviteCode: req.body.inviteCode 
    });
    return res.status(500).json({ error: 'Failed to join server' });
  }
});

/**
 * Supprimer une invitation
 * DELETE /api/servers/:serverId/invites/:inviteId
 * Seul le créateur ou l'owner du serveur peut supprimer
 */
router.delete('/:serverId/invites/:inviteId', authenticateToken, checkServerMembership, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = parseInt(req.params.serverId);
    const inviteId = parseInt(req.params.inviteId);
    const userId = req.user?.id;

    // Vérifier si l'utilisateur est le créateur ou l'owner
    const inviteCheck = await dbManager.queryServer(
      serverId,
      'SELECT created_by FROM invites WHERE id = $1',
      [inviteId]
    );

    if (inviteCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    const serverCheck = await dbManager.queryRegistry(
      'SELECT owner_id FROM servers WHERE id = $1',
      [serverId]
    );

    const isCreator = inviteCheck.rows[0].created_by === userId;
    const isOwner = serverCheck.rows[0].owner_id === userId;

    if (!isCreator && !isOwner) {
      return res.status(403).json({ error: 'Only the invite creator or server owner can delete this invite' });
    }

    // Supprimer l'invitation
    await dbManager.queryServer(
      serverId,
      'DELETE FROM invites WHERE id = $1',
      [inviteId]
    );

    logger.info('Invite deleted', { serverId, inviteId, userId });

    return res.json({ message: 'Invite deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting invite', { error: error.message });
    return res.status(500).json({ error: 'Failed to delete invite' });
  }
});

export default router;
