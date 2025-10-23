import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { dbManager } from './database';
import logger from './logger';

/**
 * Middleware pour vérifier qu'un utilisateur est membre d'un serveur
 * Empêche l'accès non autorisé aux données d'un serveur
 */
export const checkServerMembership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const serverId = parseInt(req.params.serverId || req.body.serverId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!serverId || isNaN(serverId)) {
      res.status(400).json({ error: 'Invalid server ID' });
      return;
    }

    // Vérifier dans registry_db que l'utilisateur est membre
    const memberCheck = await dbManager.queryRegistry(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (memberCheck.rows.length === 0) {
      logger.warn('Unauthorized server access attempt', { userId, serverId });
      res.status(403).json({ error: 'You are not a member of this server' });
      return;
    }

    // Vérifier que le serveur est actif
    const serverCheck = await dbManager.queryRegistry(
      'SELECT status FROM servers WHERE id = $1',
      [serverId]
    );

    if (serverCheck.rows.length === 0) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverCheck.rows[0].status !== 'active') {
      res.status(403).json({ error: 'Server is not active' });
      return;
    }

    logger.debug('Server membership verified', { userId, serverId });
    next();
  } catch (error: any) {
    logger.error('Error checking server membership', { 
      error: error.message,
      userId: req.user?.id,
      serverId: req.params.serverId 
    });
    res.status(500).json({ error: 'Failed to verify server membership' });
  }
};

/**
 * Middleware pour vérifier qu'un utilisateur est propriétaire d'un serveur
 */
export const checkServerOwnership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const serverId = parseInt(req.params.serverId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!serverId || isNaN(serverId)) {
      res.status(400).json({ error: 'Invalid server ID' });
      return;
    }

    const serverCheck = await dbManager.queryRegistry(
      'SELECT owner_id FROM servers WHERE id = $1 AND status = $2',
      [serverId, 'active']
    );

    if (serverCheck.rows.length === 0) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverCheck.rows[0].owner_id !== userId) {
      logger.warn('Unauthorized server ownership action', { userId, serverId });
      res.status(403).json({ error: 'Only the server owner can perform this action' });
      return;
    }

    logger.debug('Server ownership verified', { userId, serverId });
    next();
  } catch (error: any) {
    logger.error('Error checking server ownership', { 
      error: error.message,
      userId: req.user?.id,
      serverId: req.params.serverId 
    });
    res.status(500).json({ error: 'Failed to verify server ownership' });
  }
};

/**
 * Middleware pour vérifier qu'un utilisateur a accès à une conversation DM
 */
export const checkDMAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const conversationId = parseInt(req.params.conversationId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!conversationId || isNaN(conversationId)) {
      res.status(400).json({ error: 'Invalid conversation ID' });
      return;
    }

    // Vérifier que l'utilisateur fait partie de la conversation
    const convCheck = await dbManager.queryDM(
      'SELECT * FROM dm_conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      logger.warn('Unauthorized DM access attempt', { userId, conversationId });
      res.status(403).json({ error: 'Access denied to this conversation' });
      return;
    }

    logger.debug('DM access verified', { userId, conversationId });
    next();
  } catch (error: any) {
    logger.error('Error checking DM access', { 
      error: error.message,
      userId: req.user?.id,
      conversationId: req.params.conversationId 
    });
    res.status(500).json({ error: 'Failed to verify DM access' });
  }
};
