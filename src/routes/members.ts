import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import { getHighestRole } from './permissions';
import logger from '../utils/logger';

const router = Router();

// Obtenir la liste des membres d'un serveur avec options de tri
router.get(
  '/:serverId/members',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const sortByRole = req.query.sortByRole === 'true';
      const groupByRole = req.query.groupByRole === 'true';

      // Récupérer tous les membres du serveur depuis registry_db
      const membersResult = await dbManager.queryRegistry(
        `SELECT sm.user_id, u.username, u.avatar, sm.nickname, sm.joined_at
         FROM server_members sm
         INNER JOIN users u ON sm.user_id = u.id
         WHERE sm.server_id = $1`,
        [serverId]
      );

      const members = membersResult.rows;

      // Récupérer le owner
      const serverResult = await dbManager.queryRegistry(
        'SELECT owner_id FROM servers WHERE id = $1',
        [serverId]
      );
      const ownerId = serverResult.rows[0]?.owner_id;

      // Si tri par rôle demandé, récupérer le rôle le plus haut de chaque membre
      if (sortByRole || groupByRole) {
        const membersWithRoles = await Promise.all(
          members.map(async (member) => {
            const highestRole = await getHighestRole(serverId, member.user_id);
            return {
              ...member,
              is_owner: member.user_id === ownerId,
              highest_role_id: highestRole?.id || null,
              highest_role_position: highestRole?.position || 0,
            };
          })
        );

        // Trier par position de rôle (DESC = rôles hauts en premier)
        membersWithRoles.sort((a, b) => {
          // Owner toujours en premier
          if (a.is_owner) return -1;
          if (b.is_owner) return 1;
          // Puis par position de rôle
          return b.highest_role_position - a.highest_role_position;
        });

        // Si groupement par rôle demandé
        if (groupByRole) {
          // Récupérer tous les rôles hoisted
          const rolesResult = await dbManager.queryServer(
            serverId,
            'SELECT id, name, color, position FROM roles WHERE is_hoisted = TRUE ORDER BY position DESC',
            []
          );

          const hoistedRoles = rolesResult.rows;

          // Grouper les membres par rôle hoisted
          const grouped: any = {
            owner: [],
            roles: [],
            noRole: [],
          };

          // Owner en premier groupe
          if (ownerId) {
            const ownerMember = membersWithRoles.find((m) => m.user_id === ownerId);
            if (ownerMember) {
              grouped.owner.push(ownerMember);
            }
          }

          // Grouper par rôle hoisted
          for (const role of hoistedRoles) {
            const roleMembers = membersWithRoles.filter(
              (m) => m.highest_role_id === role.id && !m.is_owner
            );
            if (roleMembers.length > 0) {
              grouped.roles.push({
                role: {
                  id: role.id,
                  name: role.name,
                  color: role.color,
                  position: role.position,
                },
                members: roleMembers,
              });
            }
          }

          // Membres sans rôle hoisted
          const hoistedRoleIds = hoistedRoles.map((r) => r.id);
          grouped.noRole = membersWithRoles.filter(
            (m) => !hoistedRoleIds.includes(m.highest_role_id) && !m.is_owner
          );

          return res.json({ members: grouped, totalCount: members.length });
        }

        return res.json({ members: membersWithRoles, totalCount: members.length });
      }

      // Sans tri par rôle, retourner tel quel
      const membersWithOwnerFlag = members.map((m) => ({
        ...m,
        is_owner: m.user_id === ownerId,
      }));

      return res.json({ members: membersWithOwnerFlag, totalCount: members.length });
    } catch (error: any) {
      logger.error('Error fetching server members', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch members' });
    }
  }
);

export default router;
