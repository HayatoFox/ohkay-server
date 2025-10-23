import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import {
  PermissionFlags,
  DEFAULT_PERMISSIONS,
  OWNER_PERMISSIONS,
  hasPermission,
  permissionsToBigInt,
  bigIntToPermissions,
} from '../utils/permissions-flags';
import logger from '../utils/logger';
import { canManageRole } from './permissions';

const router = Router();

// Créer un rôle
router.post(
  '/:serverId/roles',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const userId = req.user?.id;
      const { name, color, permissions, position, isHoisted, isMentionable } = req.body;

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Role name is required' });
      }

      // Vérifier que l'utilisateur est owner ou a MANAGE_ROLES
      const serverResult = await dbManager.queryRegistry(
        'SELECT owner_id FROM servers WHERE id = $1',
        [serverId]
      );

      if (serverResult.rows.length === 0) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const isOwner = serverResult.rows[0].owner_id === userId;

      if (!isOwner) {
        // Vérifier la permission MANAGE_ROLES
        const userPerms = await getUserPermissions(serverId, userId!);
        if (!hasPermission(userPerms, PermissionFlags.MANAGE_ROLES)) {
          return res.status(403).json({ error: 'Missing MANAGE_ROLES permission' });
        }
      }

      // Créer le rôle
      const permissionsBigInt = permissions ? bigIntToPermissions(permissions) : DEFAULT_PERMISSIONS;
      const result = await dbManager.queryServer(
        serverId,
        `INSERT INTO roles (name, color, permissions, position, is_hoisted, is_mentionable)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          name,
          color || null,
          permissionsToBigInt(permissionsBigInt),
          position || 0,
          isHoisted || false,
          isMentionable !== undefined ? isMentionable : true,
        ]
      );

      const role = result.rows[0];

      logger.info('Role created', {
        serverId,
        roleId: role.id,
        roleName: name,
        userId,
      });

      return res.status(201).json({ role });
    } catch (error: any) {
      logger.error('Error creating role', { error: error.message });
      return res.status(500).json({ error: 'Failed to create role' });
    }
  }
);

// Obtenir tous les rôles d'un serveur
router.get(
  '/:serverId/roles',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);

      const result = await dbManager.queryServer(
        serverId,
        'SELECT * FROM roles ORDER BY position DESC',
        []
      );

      return res.json({ roles: result.rows });
    } catch (error: any) {
      logger.error('Error fetching roles', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch roles' });
    }
  }
);

// Modifier un rôle
router.patch(
  '/:serverId/roles/:roleId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const roleId = parseInt(req.params.roleId);
      const userId = req.user?.id;
      const { name, color, permissions, position, isHoisted, isMentionable } = req.body;

      // Vérifier permissions ET hiérarchie
      const hierarchyCheck = await canManageRole(serverId, userId!, roleId);
      if (!hierarchyCheck.allowed) {
        return res.status(403).json({ error: hierarchyCheck.reason || 'Cannot manage this role' });
      }

      // Construire la requête de mise à jour
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
      }

      if (color !== undefined) {
        updates.push(`color = $${paramIndex++}`);
        values.push(color);
      }

      if (permissions !== undefined) {
        updates.push(`permissions = $${paramIndex++}`);
        values.push(permissionsToBigInt(bigIntToPermissions(permissions)));
      }

      if (position !== undefined) {
        updates.push(`position = $${paramIndex++}`);
        values.push(position);
      }

      if (isHoisted !== undefined) {
        updates.push(`is_hoisted = $${paramIndex++}`);
        values.push(isHoisted);
      }

      if (isMentionable !== undefined) {
        updates.push(`is_mentionable = $${paramIndex++}`);
        values.push(isMentionable);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(roleId);
      const query = `UPDATE roles SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

      const result = await dbManager.queryServer(serverId, query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Role not found' });
      }

      logger.info('Role updated', { serverId, roleId, userId });

      return res.json({ role: result.rows[0] });
    } catch (error: any) {
      logger.error('Error updating role', { error: error.message });
      return res.status(500).json({ error: 'Failed to update role' });
    }
  }
);

// Supprimer un rôle
router.delete(
  '/:serverId/roles/:roleId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const roleId = parseInt(req.params.roleId);
      const userId = req.user?.id;

      // Vérifier que ce n'est pas le rôle @everyone
      const roleCheck = await dbManager.queryServer(
        serverId,
        'SELECT is_default FROM roles WHERE id = $1',
        [roleId]
      );

      if (roleCheck.rows[0]?.is_default) {
        return res.status(400).json({ error: 'Cannot delete @everyone role' });
      }

      // Vérifier permissions ET hiérarchie
      const hierarchyCheck = await canManageRole(serverId, userId!, roleId);
      if (!hierarchyCheck.allowed) {
        return res.status(403).json({ error: hierarchyCheck.reason || 'Cannot manage this role' });
      }

      // Supprimer le rôle
      await dbManager.queryServer(serverId, 'DELETE FROM roles WHERE id = $1', [roleId]);

      logger.info('Role deleted', { serverId, roleId, userId });

      return res.json({ message: 'Role deleted' });
    } catch (error: any) {
      logger.error('Error deleting role', { error: error.message });
      return res.status(500).json({ error: 'Failed to delete role' });
    }
  }
);

// Attribuer un rôle à un membre
router.post(
  '/:serverId/members/:memberId/roles/:roleId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const memberId = parseInt(req.params.memberId);
      const roleId = parseInt(req.params.roleId);
      const userId = req.user?.id;

      // Vérifier permissions ET hiérarchie
      const hierarchyCheck = await canManageRole(serverId, userId!, roleId);
      if (!hierarchyCheck.allowed) {
        return res.status(403).json({ error: hierarchyCheck.reason || 'Cannot manage this role' });
      }

      // Vérifier que le membre est bien sur le serveur
      const memberCheck = await dbManager.queryRegistry(
        'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
        [serverId, memberId]
      );

      if (memberCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Member not found on this server' });
      }

      // Attribuer le rôle (ignore si déjà attribué)
      await dbManager.queryServer(
        serverId,
        'INSERT INTO member_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [memberId, roleId]
      );

      logger.info('Role assigned to member', { serverId, memberId, roleId, userId });

      return res.json({ message: 'Role assigned' });
    } catch (error: any) {
      logger.error('Error assigning role', { error: error.message });
      return res.status(500).json({ error: 'Failed to assign role' });
    }
  }
);

// Retirer un rôle à un membre
router.delete(
  '/:serverId/members/:memberId/roles/:roleId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const memberId = parseInt(req.params.memberId);
      const roleId = parseInt(req.params.roleId);
      const userId = req.user?.id;

      // Vérifier permissions
      // Vérifier permissions ET hiérarchie
      const hierarchyCheck = await canManageRole(serverId, userId!, roleId);
      if (!hierarchyCheck.allowed) {
        return res.status(403).json({ error: hierarchyCheck.reason || 'Cannot manage this role' });
      }

      // Retirer le rôle
      await dbManager.queryServer(
        serverId,
        'DELETE FROM member_roles WHERE user_id = $1 AND role_id = $2',
        [memberId, roleId]
      );

      logger.info('Role removed from member', { serverId, memberId, roleId, userId });

      return res.json({ message: 'Role removed' });
    } catch (error: any) {
      logger.error('Error removing role', { error: error.message });
      return res.status(500).json({ error: 'Failed to remove role' });
    }
  }
);

// Obtenir les permissions d'un membre (helper)
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

      // Si ADMINISTRATOR, arrêter (toutes les permissions)
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

// Transférer la propriété du serveur
router.post(
  '/:serverId/transfer-ownership',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const userId = req.user?.id;
      const { newOwnerId } = req.body;

      if (!newOwnerId) {
        return res.status(400).json({ error: 'New owner ID is required' });
      }

      // Vérifier que l'utilisateur actuel est le propriétaire
      const serverResult = await dbManager.queryRegistry(
        'SELECT owner_id FROM servers WHERE id = $1',
        [serverId]
      );

      if (serverResult.rows[0]?.owner_id !== userId) {
        return res.status(403).json({ error: 'Only the owner can transfer ownership' });
      }

      // Vérifier que le nouveau propriétaire est membre
      const memberCheck = await dbManager.queryRegistry(
        'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
        [serverId, newOwnerId]
      );

      if (memberCheck.rows.length === 0) {
        return res.status(404).json({ error: 'New owner must be a member of the server' });
      }

      // Transférer
      await dbManager.queryRegistry(
        'UPDATE servers SET owner_id = $1 WHERE id = $2',
        [newOwnerId, serverId]
      );

      logger.info('Server ownership transferred', {
        serverId,
        oldOwnerId: userId,
        newOwnerId,
      });

      return res.json({ message: 'Ownership transferred', newOwnerId });
    } catch (error: any) {
      logger.error('Error transferring ownership', { error: error.message });
      return res.status(500).json({ error: 'Failed to transfer ownership' });
    }
  }
);

// Réordonner les rôles (drag & drop)
router.patch(
  '/:serverId/roles/reorder',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const userId = req.user?.id;
      const { roleOrders } = req.body; // Array de { roleId: number, position: number }

      if (!Array.isArray(roleOrders) || roleOrders.length === 0) {
        return res.status(400).json({ error: 'roleOrders must be a non-empty array' });
      }

      // Vérifier que l'utilisateur a MANAGE_ROLES
      const serverResult = await dbManager.queryRegistry(
        'SELECT owner_id FROM servers WHERE id = $1',
        [serverId]
      );

      const isOwner = serverResult.rows[0]?.owner_id === userId;

      if (!isOwner) {
        const userPerms = await getUserPermissions(serverId, userId!);
        if (!hasPermission(userPerms, PermissionFlags.MANAGE_ROLES)) {
          return res.status(403).json({ error: 'Missing MANAGE_ROLES permission' });
        }
      }

      // Vérifier la hiérarchie pour chaque rôle
      for (const { roleId } of roleOrders) {
        const hierarchyCheck = await canManageRole(serverId, userId!, roleId);
        if (!hierarchyCheck.allowed) {
          return res.status(403).json({
            error: `Cannot reorder role ${roleId}: ${hierarchyCheck.reason}`,
          });
        }
      }

      // Mettre à jour les positions en transaction
      await dbManager.queryServer(serverId, 'BEGIN', []);

      try {
        for (const { roleId, position } of roleOrders) {
          await dbManager.queryServer(
            serverId,
            'UPDATE roles SET position = $1 WHERE id = $2',
            [position, roleId]
          );
        }

        await dbManager.queryServer(serverId, 'COMMIT', []);

        logger.info('Roles reordered', { serverId, userId, roleCount: roleOrders.length });

        return res.json({ message: 'Roles reordered successfully' });
      } catch (error) {
        await dbManager.queryServer(serverId, 'ROLLBACK', []);
        throw error;
      }
    } catch (error: any) {
      logger.error('Error reordering roles', { error: error.message });
      return res.status(500).json({ error: 'Failed to reorder roles' });
    }
  }
);

export default router;
