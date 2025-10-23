import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import { PermissionFlags, hasPermission } from '../utils/permissions-flags';
import { getUserPermissions, canModerateUser } from './permissions';
import logger from '../utils/logger';

const router = Router();

// Expulser un membre (KICK)
router.post(
  '/:serverId/members/:memberId/kick',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const memberId = parseInt(req.params.memberId);
      const userId = req.user?.id;
      const { reason } = req.body;

      // Vérifier que le membre existe
      const memberCheck = await dbManager.queryRegistry(
        'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
        [serverId, memberId]
      );

      if (memberCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Member not found' });
      }

      // Vérifier permission KICK_MEMBERS ET hiérarchie
      const moderationCheck = await canModerateUser(
        serverId,
        userId!,
        memberId,
        PermissionFlags.KICK_MEMBERS
      );

      if (!moderationCheck.allowed) {
        return res.status(403).json({ 
          error: moderationCheck.reason || 'Cannot kick this member' 
        });
      }

      // Supprimer le membre
      await dbManager.queryRegistry(
        'DELETE FROM server_members WHERE server_id = $1 AND user_id = $2',
        [serverId, memberId]
      );

      // Log dans audit_log du serveur
      await dbManager.queryServer(
        serverId,
        `INSERT INTO audit_log (action, user_id, target_user_id, reason, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        ['MEMBER_KICK', userId, memberId, reason || null]
      );

      logger.info('Member kicked', { serverId, memberId, kickedBy: userId, reason });

      return res.json({ message: 'Member kicked successfully' });
    } catch (error: any) {
      logger.error('Error kicking member', { error: error.message });
      return res.status(500).json({ error: 'Failed to kick member' });
    }
  }
);

// Bannir un membre (BAN)
router.post(
  '/:serverId/bans/:memberId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const memberId = parseInt(req.params.memberId);
      const userId = req.user?.id;
      const { reason } = req.body;

      // Vérifier que le membre existe
      const memberCheck = await dbManager.queryRegistry(
        'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
        [serverId, memberId]
      );

      // Vérifier permission BAN_MEMBERS ET hiérarchie
      const moderationCheck = await canModerateUser(
        serverId,
        userId!,
        memberId,
        PermissionFlags.BAN_MEMBERS
      );

      if (!moderationCheck.allowed) {
        return res.status(403).json({ 
          error: moderationCheck.reason || 'Cannot ban this member' 
        });
      }

      // Supprimer le membre s'il est présent
      if (memberCheck.rows.length > 0) {
        await dbManager.queryRegistry(
          'DELETE FROM server_members WHERE server_id = $1 AND user_id = $2',
          [serverId, memberId]
        );
      }

      // Ajouter le ban
      await dbManager.queryServer(
        serverId,
        `INSERT INTO bans (user_id, banned_by, reason, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET banned_by = $2, reason = $3, created_at = NOW()`,
        [memberId, userId, reason || null]
      );

      // Log audit
      await dbManager.queryServer(
        serverId,
        `INSERT INTO audit_log (action, user_id, target_user_id, reason, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        ['MEMBER_BAN', userId, memberId, reason || null]
      );

      logger.info('Member banned', { serverId, memberId, bannedBy: userId, reason });

      return res.json({ message: 'Member banned successfully' });
    } catch (error: any) {
      logger.error('Error banning member', { error: error.message });
      return res.status(500).json({ error: 'Failed to ban member' });
    }
  }
);

// Débannir un membre (UNBAN)
router.delete(
  '/:serverId/bans/:memberId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const memberId = parseInt(req.params.memberId);
      const userId = req.user?.id;

      // Vérifier permission BAN_MEMBERS
      const userPerms = await getUserPermissions(serverId, userId!);
      if (!hasPermission(userPerms, PermissionFlags.BAN_MEMBERS)) {
        return res.status(403).json({ error: 'Missing BAN_MEMBERS permission' });
      }

      // Retirer le ban
      await dbManager.queryServer(
        serverId,
        'DELETE FROM bans WHERE user_id = $1',
        [memberId]
      );

      // Log audit
      await dbManager.queryServer(
        serverId,
        `INSERT INTO audit_log (action, user_id, target_user_id, created_at)
         VALUES ($1, $2, $3, NOW())`,
        ['MEMBER_UNBAN', userId, memberId]
      );

      logger.info('Member unbanned', { serverId, memberId, unbannedBy: userId });

      return res.json({ message: 'Member unbanned successfully' });
    } catch (error: any) {
      logger.error('Error unbanning member', { error: error.message });
      return res.status(500).json({ error: 'Failed to unban member' });
    }
  }
);

// Lister les bans d'un serveur
router.get(
  '/:serverId/bans',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const userId = req.user?.id;

      // Vérifier permission BAN_MEMBERS
      const userPerms = await getUserPermissions(serverId, userId!);
      if (!hasPermission(userPerms, PermissionFlags.BAN_MEMBERS)) {
        return res.status(403).json({ error: 'Missing BAN_MEMBERS permission' });
      }

      const result = await dbManager.queryServer(
        serverId,
        'SELECT * FROM bans ORDER BY created_at DESC',
        []
      );

      // Enrichir avec les infos utilisateurs
      const bans = await Promise.all(
        result.rows.map(async (ban: any) => {
          const userResult = await dbManager.queryAuth(
            'SELECT id, username FROM users WHERE id = $1',
            [ban.user_id]
          );

          const bannerResult = await dbManager.queryAuth(
            'SELECT id, username FROM users WHERE id = $1',
            [ban.banned_by]
          );

          return {
            ...ban,
            user: userResult.rows[0],
            bannedBy: bannerResult.rows[0],
          };
        })
      );

      return res.json({ bans });
    } catch (error: any) {
      logger.error('Error fetching bans', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch bans' });
    }
  }
);

// Modifier le pseudo d'un membre (MANAGE_NICKNAMES)
router.patch(
  '/:serverId/members/:memberId/nickname',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const memberId = parseInt(req.params.memberId);
      const userId = req.user?.id;
      const { nickname } = req.body;

      // Si c'est pour soi-même, vérifier CHANGE_NICKNAME
      // Sinon, vérifier MANAGE_NICKNAMES
      const userPerms = await getUserPermissions(serverId, userId!);
      
      if (memberId === userId) {
        if (!hasPermission(userPerms, PermissionFlags.CHANGE_NICKNAME)) {
          return res.status(403).json({ error: 'Missing CHANGE_NICKNAME permission' });
        }
      } else {
        if (!hasPermission(userPerms, PermissionFlags.MANAGE_NICKNAMES)) {
          return res.status(403).json({ error: 'Missing MANAGE_NICKNAMES permission' });
        }
      }

      // Mettre à jour le pseudo dans registry
      await dbManager.queryRegistry(
        'UPDATE server_members SET nickname = $1 WHERE server_id = $2 AND user_id = $3',
        [nickname || null, serverId, memberId]
      );

      logger.info('Member nickname updated', { serverId, memberId, nickname, changedBy: userId });

      return res.json({ message: 'Nickname updated', nickname });
    } catch (error: any) {
      logger.error('Error updating nickname', { error: error.message });
      return res.status(500).json({ error: 'Failed to update nickname' });
    }
  }
);

export default router;
