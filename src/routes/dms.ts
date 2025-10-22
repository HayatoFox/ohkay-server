import { Router, Response } from 'express';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import logger from '../utils/logger';

const router = Router();

// Get all DM conversations for current user
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Récupérer toutes les conversations de l'utilisateur
    const result = await dbManager.queryDM(
      `SELECT 
        c.id,
        c.user1_id,
        c.user2_id,
        c.last_message_at,
        c.created_at,
        CASE 
          WHEN c.user1_id = $1 THEN c.user2_id 
          ELSE c.user1_id 
        END as other_user_id
      FROM dm_conversations c
      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY c.last_message_at DESC NULLS LAST`,
      [userId]
    );

    // Récupérer les infos des autres utilisateurs depuis auth_db
    const conversations = await Promise.all(
      result.rows.map(async (conv) => {
        const userResult = await dbManager.queryAuth(
          `SELECT u.id, u.username, u.status, p.display_name, p.avatar_url
           FROM users u
           LEFT JOIN user_profiles p ON u.id = p.user_id
           WHERE u.id = $1`,
          [conv.other_user_id]
        );

        const otherUser = userResult.rows[0] || {};

        // Compter messages non lus
        const unreadResult = await dbManager.queryDM(
          `SELECT COUNT(*) as unread_count
           FROM dm_messages m
           INNER JOIN dm_read_status rs ON rs.conversation_id = m.conversation_id
           WHERE m.conversation_id = $1
             AND rs.user_id = $2
             AND m.sender_id != $2
             AND m.deleted_at IS NULL
             AND (rs.last_read_message_id IS NULL OR m.id > rs.last_read_message_id)`,
          [conv.id, userId]
        );

        return {
          id: conv.id,
          otherUser: {
            id: otherUser.id,
            username: otherUser.username,
            displayName: otherUser.display_name,
            avatarUrl: otherUser.avatar_url,
            status: otherUser.status,
          },
          lastMessageAt: conv.last_message_at,
          unreadCount: parseInt(unreadResult.rows[0]?.unread_count || '0'),
          createdAt: conv.created_at,
        };
      })
    );

    logger.info('DM conversations retrieved', { userId, count: conversations.length });
    
    return res.json({ conversations });
  } catch (error: any) {
    logger.error('Error fetching DM conversations', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get or create DM conversation with a user
router.post('/:recipientId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const recipientId = parseInt(req.params.recipientId);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (userId === recipientId) {
      return res.status(400).json({ error: 'Cannot create DM with yourself' });
    }

    // Vérifier que le destinataire existe
    const recipientResult = await dbManager.queryAuth(
      'SELECT id FROM users WHERE id = $1',
      [recipientId]
    );

    if (recipientResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Utiliser la fonction PostgreSQL pour créer ou récupérer la conversation
    const result = await dbManager.queryDM(
      'SELECT get_or_create_conversation($1, $2) as conversation_id',
      [userId, recipientId]
    );

    const conversationId = result.rows[0].conversation_id;

    logger.info('DM conversation created/retrieved', { userId, recipientId, conversationId });

    return res.json({
      message: 'Conversation ready',
      conversationId,
    });
  } catch (error: any) {
    logger.error('Error creating DM conversation', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Get messages from a DM conversation
router.get('/:conversationId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const conversationId = parseInt(req.params.conversationId);
    const limit = parseInt(req.query.limit as string) || 50;
    const before = req.query.before ? parseInt(req.query.before as string) : null;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Vérifier que l'utilisateur fait partie de la conversation
    const convCheck = await dbManager.queryDM(
      'SELECT id FROM dm_conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this conversation' });
    }

    // Récupérer les messages
    let query = `
      SELECT 
        m.id,
        m.sender_id,
        m.content,
        m.is_edited,
        m.created_at,
        m.edited_at
      FROM dm_messages m
      WHERE m.conversation_id = $1
        AND m.deleted_at IS NULL
    `;

    const params: any[] = [conversationId];

    if (before) {
      query += ` AND m.id < $${params.length + 1}`;
      params.push(before);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await dbManager.queryDM(query, params);

    // Récupérer les infos des expéditeurs depuis auth_db
    const messages = await Promise.all(
      result.rows.map(async (msg) => {
        const userResult = await dbManager.queryAuth(
          `SELECT u.username, p.display_name, p.avatar_url
           FROM users u
           LEFT JOIN user_profiles p ON u.id = p.user_id
           WHERE u.id = $1`,
          [msg.sender_id]
        );

        const sender = userResult.rows[0] || {};

        return {
          id: msg.id,
          senderId: msg.sender_id,
          senderUsername: sender.username,
          senderDisplayName: sender.display_name,
          senderAvatarUrl: sender.avatar_url,
          content: msg.content,
          isEdited: msg.is_edited,
          createdAt: msg.created_at,
          editedAt: msg.edited_at,
        };
      })
    );

    // Mettre à jour le statut de lecture
    if (messages.length > 0) {
      const lastMessageId = messages[0].id;
      await dbManager.queryDM(
        `UPDATE dm_read_status 
         SET last_read_message_id = $1, last_read_at = CURRENT_TIMESTAMP
         WHERE conversation_id = $2 AND user_id = $3`,
        [lastMessageId, conversationId, userId]
      );
    }

    logger.info('DM messages retrieved', { conversationId, userId, count: messages.length });

    return res.json({ messages: messages.reverse() }); // Reverse pour avoir l'ordre chronologique
  } catch (error: any) {
    logger.error('Error fetching DM messages', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a message in a DM conversation
router.post('/:conversationId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const conversationId = parseInt(req.params.conversationId);
    const { content } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    // Vérifier que l'utilisateur fait partie de la conversation
    const convCheck = await dbManager.queryDM(
      'SELECT user1_id, user2_id FROM dm_conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this conversation' });
    }

    // Insérer le message
    const result = await dbManager.queryDM(
      'INSERT INTO dm_messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *',
      [conversationId, userId, content.trim()]
    );

    const message = result.rows[0];

    // Récupérer les infos de l'expéditeur
    const userResult = await dbManager.queryAuth(
      `SELECT u.username, p.display_name, p.avatar_url
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [userId]
    );

    const sender = userResult.rows[0];

    logger.info('DM message sent', { conversationId, userId, messageId: message.id });

    const responseMessage = {
      id: message.id,
      conversationId: message.conversation_id,
      senderId: message.sender_id,
      senderUsername: sender.username,
      senderDisplayName: sender.display_name,
      senderAvatarUrl: sender.avatar_url,
      content: message.content,
      isEdited: message.is_edited,
      createdAt: message.created_at,
    };

    // TODO: Émettre l'événement Socket.io pour le destinataire
    // const recipientId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;
    // io.to(`user_${recipientId}`).emit('new_private_message', responseMessage);

    return res.status(201).json({
      message: 'Message sent',
      data: responseMessage,
    });
  } catch (error: any) {
    logger.error('Error sending DM message', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// Delete a DM message (soft delete)
router.delete('/:conversationId/messages/:messageId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const conversationId = parseInt(req.params.conversationId);
    const messageId = parseInt(req.params.messageId);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Vérifier que le message appartient à l'utilisateur
    const msgCheck = await dbManager.queryDM(
      'SELECT id FROM dm_messages WHERE id = $1 AND conversation_id = $2 AND sender_id = $3 AND deleted_at IS NULL',
      [messageId, conversationId, userId]
    );

    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or already deleted' });
    }

    // Soft delete
    await dbManager.queryDM(
      'UPDATE dm_messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
      [messageId]
    );

    logger.info('DM message deleted', { conversationId, userId, messageId });

    return res.json({ message: 'Message deleted' });
  } catch (error: any) {
    logger.error('Error deleting DM message', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;
