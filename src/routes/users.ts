import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import logger from '../utils/logger';

const router = Router();

// Mettre à jour le statut utilisateur
router.put('/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { status, customStatus, statusEmoji } = req.body;

    // Valider le statut
    const validStatuses = ['online', 'away', 'dnd', 'offline'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Construire la requête de mise à jour
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (status) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (customStatus !== undefined) {
      updates.push(`custom_status = $${paramIndex++}`);
      values.push(customStatus || null);
    }

    if (statusEmoji !== undefined) {
      updates.push(`status_emoji = $${paramIndex++}`);
      values.push(statusEmoji || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No status fields to update' });
    }

    values.push(userId);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, status, custom_status, status_emoji`;

    const result = await dbManager.queryAuth(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info('User status updated', {
      userId,
      status: result.rows[0].status,
      customStatus: result.rows[0].custom_status,
    });

    return res.json({ user: result.rows[0] });
  } catch (error: any) {
    logger.error('Error updating user status', { error: error.message });
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

// Récupérer le statut d'un utilisateur
router.get('/:userId/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    const result = await dbManager.queryAuth(
      'SELECT id, username, status, custom_status, status_emoji, last_seen FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: result.rows[0] });
  } catch (error: any) {
    logger.error('Error fetching user status', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Récupérer les statuts de plusieurs utilisateurs
router.post('/statuses', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds must be a non-empty array' });
    }

    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const query = `SELECT id, username, status, custom_status, status_emoji, last_seen FROM users WHERE id IN (${placeholders})`;

    const result = await dbManager.queryAuth(query, userIds);

    return res.json({ users: result.rows });
  } catch (error: any) {
    logger.error('Error fetching user statuses', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch statuses' });
  }
});

export default router;
