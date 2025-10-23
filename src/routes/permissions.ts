import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import {
  PermissionFlags,
  hasPermission,
  permissionsToBigInt,
  bigIntToPermissions,
  OWNER_PERMISSIONS,
} from '../utils/permissions-flags';
import logger from '../utils/logger';

const router = Router();

// Helper: Obtenir les permissions d'un utilisateur dans un serveur
async function getUserPermissions(serverId: number, userId: number): Promise<bigint> {
  try {
    // Vérifier si owner
    const serverResult = await dbManager.queryRegistry(
      'SELECT owner_id FROM servers WHERE id = $1',
      [serverId]
    );

    if (serverResult.rows[0]?.owner_id === userId) {
      return OWNER_PERMISSIONS;
    }

    // Récupérer tous les rôles du membre
    const rolesResult = await dbManager.queryServer(
      serverId,
      `SELECT r.permissions FROM roles r
       INNER JOIN member_roles mr ON r.id = mr.role_id
       WHERE mr.user_id = $1
       ORDER BY r.position DESC`,
      [userId]
    );

    // Récupérer le rôle @everyone
    const everyoneResult = await dbManager.queryServer(
      serverId,
      'SELECT permissions FROM roles WHERE is_default = TRUE',
      []
    );

    let permissions = 0n;

    // Commencer avec @everyone
    if (everyoneResult.rows.length > 0) {
      permissions = bigIntToPermissions(everyoneResult.rows[0].permissions);
    }

    // Combiner avec les autres rôles
    for (const role of rolesResult.rows) {
      const rolePerms = bigIntToPermissions(role.permissions);
      permissions |= rolePerms;

      // Si ADMINISTRATOR, retourner toutes les permissions
      if ((rolePerms & PermissionFlags.ADMINISTRATOR) !== 0n) {
        return OWNER_PERMISSIONS;
      }
    }

    return permissions;
  } catch (error) {
    logger.error('Error computing user permissions', { error });
    return 0n;
  }
}

// Helper: Obtenir les permissions d'un utilisateur dans un channel spécifique
async function getUserChannelPermissions(
  serverId: number,
  channelId: number,
  userId: number
): Promise<bigint> {
  try {
    const basePermissions = await getUserPermissions(serverId, userId);

    // Owner bypass tout
    const serverResult = await dbManager.queryRegistry(
      'SELECT owner_id FROM servers WHERE id = $1',
      [serverId]
    );

    if (serverResult.rows[0]?.owner_id === userId) {
      return OWNER_PERMISSIONS;
    }

    // Si ADMINISTRATOR, bypass channel overrides
    if ((basePermissions & PermissionFlags.ADMINISTRATOR) !== 0n) {
      return OWNER_PERMISSIONS;
    }

    // Récupérer les overrides du channel pour les rôles de l'utilisateur
    const rolesResult = await dbManager.queryServer(
      serverId,
      `SELECT mr.role_id FROM member_roles mr WHERE mr.user_id = $1`,
      [userId]
    );

    const roleIds = rolesResult.rows.map((r: any) => r.role_id);

    let permissions = basePermissions;

    if (roleIds.length > 0) {
      const placeholders = roleIds.map((_, i) => `$${i + 2}`).join(',');
      const overridesResult = await dbManager.queryServer(
        serverId,
        `SELECT allow_permissions, deny_permissions FROM channel_permissions
         WHERE channel_id = $1 AND role_id IN (${placeholders})`,
        [channelId, ...roleIds]
      );

      // Appliquer les overrides (deny d'abord, puis allow)
      for (const override of overridesResult.rows) {
        const deny = bigIntToPermissions(override.deny_permissions);
        const allow = bigIntToPermissions(override.allow_permissions);

        permissions &= ~deny; // Retirer les deny
        permissions |= allow; // Ajouter les allow
      }
    }

    // Overrides spécifiques à l'utilisateur (priorité sur les rôles)
    const userOverrideResult = await dbManager.queryServer(
      serverId,
      `SELECT allow_permissions, deny_permissions FROM channel_permissions
       WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId]
    );

    if (userOverrideResult.rows.length > 0) {
      const deny = bigIntToPermissions(userOverrideResult.rows[0].deny_permissions);
      const allow = bigIntToPermissions(userOverrideResult.rows[0].allow_permissions);

      permissions &= ~deny;
      permissions |= allow;
    }

    return permissions;
  } catch (error) {
    logger.error('Error computing channel permissions', { error });
    return 0n;
  }
}

// Créer un override de permissions pour un channel
router.post(
  '/:serverId/channels/:channelId/permissions',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const userId = req.user?.id;
      const { roleId, targetUserId, allowPermissions, denyPermissions } = req.body;

      if (!roleId && !targetUserId) {
        return res.status(400).json({ error: 'Either roleId or targetUserId is required' });
      }

      // Vérifier permissions MANAGE_ROLES ou MANAGE_CHANNELS
      const userPerms = await getUserPermissions(serverId, userId!);
      if (
        !hasPermission(userPerms, PermissionFlags.MANAGE_ROLES) &&
        !hasPermission(userPerms, PermissionFlags.MANAGE_CHANNELS)
      ) {
        return res.status(403).json({ error: 'Missing MANAGE_ROLES or MANAGE_CHANNELS permission' });
      }

      const allow = allowPermissions ? bigIntToPermissions(allowPermissions) : 0n;
      const deny = denyPermissions ? bigIntToPermissions(denyPermissions) : 0n;

      // Insérer ou mettre à jour l'override
      const result = await dbManager.queryServer(
        serverId,
        `INSERT INTO channel_permissions (channel_id, role_id, user_id, allow_permissions, deny_permissions)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id, COALESCE(role_id, 0), COALESCE(user_id, 0))
         DO UPDATE SET allow_permissions = $4, deny_permissions = $5
         RETURNING *`,
        [channelId, roleId || null, targetUserId || null, permissionsToBigInt(allow), permissionsToBigInt(deny)]
      );

      logger.info('Channel permission override created', {
        serverId,
        channelId,
        roleId,
        targetUserId,
      });

      return res.status(201).json({ permission: result.rows[0] });
    } catch (error: any) {
      logger.error('Error creating channel permission', { error: error.message });
      return res.status(500).json({ error: 'Failed to create channel permission' });
    }
  }
);

// Supprimer un override de permissions
router.delete(
  '/:serverId/channels/:channelId/permissions/:permissionId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const permissionId = parseInt(req.params.permissionId);
      const userId = req.user?.id;

      // Vérifier permissions
      const userPerms = await getUserPermissions(serverId, userId!);
      if (
        !hasPermission(userPerms, PermissionFlags.MANAGE_ROLES) &&
        !hasPermission(userPerms, PermissionFlags.MANAGE_CHANNELS)
      ) {
        return res.status(403).json({ error: 'Missing MANAGE_ROLES or MANAGE_CHANNELS permission' });
      }

      await dbManager.queryServer(
        serverId,
        'DELETE FROM channel_permissions WHERE id = $1 AND channel_id = $2',
        [permissionId, channelId]
      );

      logger.info('Channel permission override deleted', {
        serverId,
        channelId,
        permissionId,
      });

      return res.json({ message: 'Permission override deleted' });
    } catch (error: any) {
      logger.error('Error deleting channel permission', { error: error.message });
      return res.status(500).json({ error: 'Failed to delete channel permission' });
    }
  }
);

// Obtenir les permissions d'un membre (pour debugging)
router.get(
  '/:serverId/members/:memberId/permissions',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const memberId = parseInt(req.params.memberId);

      const permissions = await getUserPermissions(serverId, memberId);

      return res.json({
        permissions: permissionsToBigInt(permissions),
        permissionsDecimal: permissions.toString(),
      });
    } catch (error: any) {
      logger.error('Error fetching member permissions', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch permissions' });
    }
  }
);

// Obtenir les permissions d'un membre dans un channel
router.get(
  '/:serverId/channels/:channelId/members/:memberId/permissions',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const memberId = parseInt(req.params.memberId);

      const permissions = await getUserChannelPermissions(serverId, channelId, memberId);

      return res.json({
        permissions: permissionsToBigInt(permissions),
        permissionsDecimal: permissions.toString(),
      });
    } catch (error: any) {
      logger.error('Error fetching channel permissions', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch channel permissions' });
    }
  }
);

// Helper: Obtenir le rôle le plus haut d'un utilisateur (pour la hiérarchie)
async function getHighestRole(
  serverId: number,
  userId: number
): Promise<{ id: number; position: number } | null> {
  try {
    // Vérifier si owner (position infinie)
    const serverResult = await dbManager.queryRegistry(
      'SELECT owner_id FROM servers WHERE id = $1',
      [serverId]
    );

    if (serverResult.rows[0]?.owner_id === userId) {
      return { id: 0, position: Number.MAX_SAFE_INTEGER }; // Owner a la position la plus haute
    }

    // Récupérer le rôle avec la position la plus élevée
    const result = await dbManager.queryServer(
      serverId,
      `SELECT r.id, r.position 
       FROM roles r
       INNER JOIN member_roles mr ON r.id = mr.role_id
       WHERE mr.user_id = $1
       ORDER BY r.position DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      id: result.rows[0].id,
      position: result.rows[0].position,
    };
  } catch (error) {
    logger.error('Error getting highest role', { error, serverId, userId });
    return null;
  }
}

// Helper: Vérifier si un utilisateur peut gérer un rôle (hiérarchie)
async function canManageRole(
  serverId: number,
  actorUserId: number,
  targetRoleId: number
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // Owner bypass tout
    const serverResult = await dbManager.queryRegistry(
      'SELECT owner_id FROM servers WHERE id = $1',
      [serverId]
    );

    if (serverResult.rows[0]?.owner_id === actorUserId) {
      return { allowed: true };
    }

    // Vérifier les permissions de l'acteur
    const actorPerms = await getUserPermissions(serverId, actorUserId);
    const hasManageRoles = hasPermission(actorPerms, PermissionFlags.MANAGE_ROLES);
    const hasAdministrator = hasPermission(actorPerms, PermissionFlags.ADMINISTRATOR);

    if (!hasManageRoles && !hasAdministrator) {
      return { allowed: false, reason: 'Missing MANAGE_ROLES or ADMINISTRATOR permission' };
    }

    // Récupérer la position du rôle cible
    const targetRoleResult = await dbManager.queryServer(
      serverId,
      'SELECT position, permissions FROM roles WHERE id = $1',
      [targetRoleId]
    );

    if (targetRoleResult.rows.length === 0) {
      return { allowed: false, reason: 'Target role not found' };
    }

    const targetRole = targetRoleResult.rows[0];
    const targetRolePerms = bigIntToPermissions(targetRole.permissions);

    // Si le rôle cible a ADMINISTRATOR, seul le owner ou quelqu'un avec un rôle plus haut avec ADMIN peut le gérer
    const targetHasAdmin = (targetRolePerms & PermissionFlags.ADMINISTRATOR) !== 0n;

    // Récupérer le rôle le plus haut de l'acteur
    const actorHighestRole = await getHighestRole(serverId, actorUserId);

    if (!actorHighestRole) {
      return { allowed: false, reason: 'Actor has no roles' };
    }

    // Vérification de hiérarchie: le rôle de l'acteur doit être STRICTEMENT au-dessus du rôle cible
    if (actorHighestRole.position <= targetRole.position) {
      return { allowed: false, reason: 'Target role is equal or higher in hierarchy' };
    }

    // Si le rôle cible a ADMINISTRATOR, l'acteur doit aussi avoir ADMINISTRATOR dans son highest role
    if (targetHasAdmin && !hasAdministrator) {
      return { 
        allowed: false, 
        reason: 'Cannot manage administrator role without ADMINISTRATOR permission' 
      };
    }

    return { allowed: true };
  } catch (error) {
    logger.error('Error checking role management permission', { error, serverId, actorUserId, targetRoleId });
    return { allowed: false, reason: 'Internal error' };
  }
}

// Helper: Vérifier si un utilisateur peut modérer un autre (kick/ban avec hiérarchie)
async function canModerateUser(
  serverId: number,
  actorUserId: number,
  targetUserId: number,
  requiredPermission: bigint
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // Ne peut pas se modérer soi-même
    if (actorUserId === targetUserId) {
      return { allowed: false, reason: 'Cannot moderate yourself' };
    }

    // Owner bypass tout (sauf owner ne peut pas être modéré)
    const serverResult = await dbManager.queryRegistry(
      'SELECT owner_id FROM servers WHERE id = $1',
      [serverId]
    );

    const ownerId = serverResult.rows[0]?.owner_id;

    // Ne peut pas modérer le owner
    if (targetUserId === ownerId) {
      return { allowed: false, reason: 'Cannot moderate server owner' };
    }

    // Si l'acteur est owner, il peut modérer
    if (actorUserId === ownerId) {
      return { allowed: true };
    }

    // Vérifier que l'acteur a la permission requise (KICK_MEMBERS ou BAN_MEMBERS)
    const actorPerms = await getUserPermissions(serverId, actorUserId);
    if (!hasPermission(actorPerms, requiredPermission)) {
      return { allowed: false, reason: 'Missing required permission' };
    }

    // Vérification de hiérarchie: comparer les rôles les plus hauts
    const actorHighestRole = await getHighestRole(serverId, actorUserId);
    const targetHighestRole = await getHighestRole(serverId, targetUserId);

    if (!actorHighestRole) {
      return { allowed: false, reason: 'Actor has no roles' };
    }

    // Si la cible n'a pas de rôle, l'acteur peut modérer (sauf si c'est l'owner, déjà vérifié)
    if (!targetHighestRole) {
      return { allowed: true };
    }

    // Le rôle de l'acteur doit être STRICTEMENT au-dessus de celui de la cible
    if (actorHighestRole.position <= targetHighestRole.position) {
      return { allowed: false, reason: 'Target has equal or higher role in hierarchy' };
    }

    // Vérifier si la cible a ADMINISTRATOR
    const targetPerms = await getUserPermissions(serverId, targetUserId);
    const targetHasAdmin = hasPermission(targetPerms, PermissionFlags.ADMINISTRATOR);

    // Si la cible a ADMINISTRATOR, l'acteur doit aussi avoir ADMINISTRATOR
    if (targetHasAdmin && !hasPermission(actorPerms, PermissionFlags.ADMINISTRATOR)) {
      return { 
        allowed: false, 
        reason: 'Cannot moderate user with ADMINISTRATOR permission without having it yourself' 
      };
    }

    return { allowed: true };
  } catch (error) {
    logger.error('Error checking moderation permission', { error, serverId, actorUserId, targetUserId });
    return { allowed: false, reason: 'Internal error' };
  }
}

export default router;
export { getUserPermissions, getUserChannelPermissions, getHighestRole, canManageRole, canModerateUser };
