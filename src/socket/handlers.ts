import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/auth';
import { dbManager } from '../utils/database';
import { encryptMessage, decryptMessage } from '../utils/crypto';
import { setupVoiceHandlers } from './voice-handlers';
import logger from '../utils/logger';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  username?: string;
}

export const setupSocketHandlers = (io: Server) => {
  // Authentication middleware
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      logger.warn('Socket connection attempt without token');
      return next(new Error('Authentication token required'));
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      logger.warn('Socket connection attempt with invalid token');
      return next(new Error('Invalid authentication token'));
    }

    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    logger.info('User connected via WebSocket', { 
      userId: socket.userId, 
      username: socket.username,
      socketId: socket.id 
    });

    // Store session
    try {
      await dbManager.queryAuth(
        'INSERT INTO sessions (user_id, socket_id, ip_address) VALUES ($1, $2, $3)',
        [socket.userId, socket.id, socket.handshake.address]
      );
    } catch (error: any) {
      logger.error('Failed to store session', { error: error.message });
    }

    // Join user to their personal room
    socket.join(`user:${socket.userId}`);

    // Setup voice handlers for this socket
    setupVoiceHandlers(io, socket);

    // Handle joining a server
    socket.on('join_server', async (serverId: number) => {
      try {
        // Vérifier que l'utilisateur est membre
        const memberCheck = await dbManager.queryRegistry(
          'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
          [serverId, socket.userId]
        );

        if (memberCheck.rows.length === 0) {
          socket.emit('error', { message: 'Not a member of this server' });
          return;
        }

        const roomName = `server:${serverId}`;
        socket.join(roomName);
        
        logger.info('User joined server', { 
          userId: socket.userId, 
          serverId,
          socketId: socket.id 
        });

        socket.emit('joined_server', { serverId });
        socket.to(roomName).emit('member_joined', { 
          userId: socket.userId, 
          username: socket.username 
        });
      } catch (error: any) {
        logger.error('Error joining server', { error: error.message, serverId });
        socket.emit('error', { message: 'Failed to join server' });
      }
    });

    // Handle leaving a server
    socket.on('leave_server', (serverId: number) => {
      const roomName = `server:${serverId}`;
      socket.leave(roomName);
      
      logger.info('User left server', { 
        userId: socket.userId, 
        serverId 
      });

      socket.to(roomName).emit('member_left', { 
        userId: socket.userId, 
        username: socket.username 
      });
    });

    // Handle joining a channel
    socket.on('join_channel', async (channelId: number) => {
      try {
        const roomName = `channel:${channelId}`;
        socket.join(roomName);
        
        logger.info('User joined channel', { 
          userId: socket.userId, 
          channelId,
          socketId: socket.id 
        });

        socket.emit('joined_channel', { channelId });
        socket.to(roomName).emit('user_joined', { 
          userId: socket.userId, 
          username: socket.username 
        });
      } catch (error: any) {
        logger.error('Error joining channel', { error: error.message, channelId });
        socket.emit('error', { message: 'Failed to join channel' });
      }
    });

    // Handle leaving a channel
    socket.on('leave_channel', (channelId: number) => {
      const roomName = `channel:${channelId}`;
      socket.leave(roomName);
      
      logger.info('User left channel', { 
        userId: socket.userId, 
        channelId 
      });

      socket.to(roomName).emit('user_left', { 
        userId: socket.userId, 
        username: socket.username 
      });
    });

    // Handle sending a message
    socket.on('send_message', async (data: { 
      channelId: number; 
      content: string; 
      serverId: number;
      messageType?: 'text' | 'file' | 'image' | 'video' | 'gif';
      attachments?: any[];
    }): Promise<void> => {
      try {
        const { channelId, content, serverId, messageType = 'text', attachments = [] } = data;

        if (!content || content.trim().length === 0) {
          socket.emit('error', { message: 'Message content cannot be empty' });
          return;
        }

        if (!serverId) {
          socket.emit('error', { message: 'Server ID is required' });
          return;
        }

        // Vérifier l'accès au serveur
        const memberCheck = await dbManager.queryRegistry(
          'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
          [serverId, socket.userId]
        );

        if (memberCheck.rows.length === 0) {
          socket.emit('error', { message: 'Not authorized to send messages in this server' });
          return;
        }

        // Vérifier les permissions de channel (SEND_MESSAGES + ATTACH_FILES si nécessaire)
        const { getUserChannelPermissions } = await import('../routes/permissions');
        const { PermissionFlags, hasPermission } = await import('../utils/permissions-flags');
        
        const channelPerms = await getUserChannelPermissions(serverId, channelId, socket.userId!);
        
        if (!hasPermission(channelPerms, PermissionFlags.SEND_MESSAGES)) {
          socket.emit('error', { message: 'Missing SEND_MESSAGES permission' });
          return;
        }

        if (attachments.length > 0 && !hasPermission(channelPerms, PermissionFlags.ATTACH_FILES)) {
          socket.emit('error', { message: 'Missing ATTACH_FILES permission' });
          return;
        }

        // Vérifier les emojis custom (USE_EXTERNAL_EMOJIS)
        const { extractCustomEmojis, canUseEmojis } = await import('../utils/emoji-utils');
        const customEmojis = extractCustomEmojis(content);
        
        if (customEmojis.length > 0) {
          const hasUseExternalEmojis = hasPermission(channelPerms, PermissionFlags.USE_EXTERNAL_EMOJIS);
          const emojiCheck = await canUseEmojis(socket.userId!, serverId, customEmojis, hasUseExternalEmojis);
          
          if (!emojiCheck.allowed) {
            socket.emit('error', { message: emojiCheck.reason });
            return;
          }
        }

        // Récupérer la clé de chiffrement du serveur
        const serverResult = await dbManager.queryRegistry(
          'SELECT encryption_key FROM servers WHERE id = $1',
          [serverId]
        );

        if (serverResult.rows.length === 0) {
          socket.emit('error', { message: 'Server not found' });
          return;
        }

        const serverKey = serverResult.rows[0].encryption_key;

        // Si pièces jointes, encoder en JSON avec le texte
        let contentToEncrypt = content;
        if (attachments.length > 0) {
          contentToEncrypt = JSON.stringify({ text: content, attachments });
        }

        // Chiffrer le message AVANT de le stocker
        const encryptedContent = encryptMessage(contentToEncrypt, serverKey);

        // Insérer le message CHIFFRÉ dans la DB du serveur
        const result = await dbManager.queryServer(
          serverId,
          `INSERT INTO messages (channel_id, user_id, content, message_type) 
           VALUES ($1, $2, $3, $4) 
           RETURNING id, channel_id, user_id, content, message_type, created_at`,
          [channelId, socket.userId, encryptedContent, messageType]
        );

        const message = result.rows[0];
        
        // Récupérer les infos utilisateur depuis auth_db
        const userResult = await dbManager.queryAuth(
          `SELECT u.username, p.display_name, p.avatar_url
           FROM users u
           LEFT JOIN user_profiles p ON u.id = p.user_id
           WHERE u.id = $1`,
          [socket.userId]
        );

        // Déchiffrer le message pour l'envoyer aux clients (en clair via WebSocket sécurisé)
        const decryptedContent = decryptMessage(message.content, serverKey);

        const fullMessage = {
          ...message,
          content: decryptedContent, // Envoyer en clair aux clients connectés
          ...userResult.rows[0],
        };

        logger.info('Message sent (encrypted in DB)', { 
          messageId: message.id, 
          userId: socket.userId, 
          channelId,
          serverId,
          encryptedLength: encryptedContent.length
        });

        io.to(`channel:${channelId}`).emit('new_message', fullMessage);
      } catch (error: any) {
        logger.error('Error sending message', { error: error.message, stack: error.stack });
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle private messages (DMs)
    socket.on('send_private_message', async (data: { recipientId: number; content: string }): Promise<void> => {
      try {
        const { recipientId, content } = data;

        if (!content || content.trim().length === 0) {
          socket.emit('error', { message: 'Message content cannot be empty' });
          return;
        }

        // 1. Récupérer ou créer la conversation DM
        const convResult = await dbManager.queryDM(
          'SELECT get_or_create_conversation($1, $2) as conversation_id',
          [socket.userId, recipientId]
        );

        const conversationId = convResult.rows[0].conversation_id;

        // 2. Insérer le message dans dm_messages
        const result = await dbManager.queryDM(
          `INSERT INTO dm_messages (conversation_id, sender_id, content) 
           VALUES ($1, $2, $3) 
           RETURNING id, conversation_id, sender_id, content, created_at`,
          [conversationId, socket.userId, content]
        );

        const message = result.rows[0];
        
        // 3. Récupérer les infos utilisateur depuis auth_db
        const userResult = await dbManager.queryAuth(
          `SELECT u.username, p.display_name, p.avatar_url
           FROM users u
           LEFT JOIN user_profiles p ON u.id = p.user_id
           WHERE u.id = $1`,
          [socket.userId]
        );

        const fullMessage = {
          ...message,
          senderUsername: userResult.rows[0]?.username,
          senderDisplayName: userResult.rows[0]?.display_name,
          senderAvatarUrl: userResult.rows[0]?.avatar_url,
        };

        logger.info('Private message sent', { 
          messageId: message.id,
          conversationId,
          senderId: socket.userId, 
          recipientId 
        });

        // 4. Émettre vers les deux utilisateurs
        socket.emit('new_private_message', fullMessage);
        io.to(`user:${recipientId}`).emit('new_private_message', fullMessage);
      } catch (error: any) {
        logger.error('Error sending private message', { error: error.message });
        socket.emit('error', { message: 'Failed to send private message' });
      }
    });

    // Handle typing indicators
    socket.on('typing', (channelId: number) => {
      socket.to(`channel:${channelId}`).emit('user_typing', { 
        userId: socket.userId, 
        username: socket.username 
      });
    });

    // Handle status changes
    socket.on('status_change', async (data: { 
      status: 'online' | 'away' | 'dnd' | 'offline';
      customStatus?: string;
      statusEmoji?: string;
    }) => {
      try {
        const { status, customStatus, statusEmoji } = data;

        // Mettre à jour en DB
        await dbManager.queryAuth(
          `UPDATE users SET status = $1, custom_status = $2, status_emoji = $3 WHERE id = $4`,
          [status, customStatus || null, statusEmoji || null, socket.userId]
        );

        logger.info('User status changed', {
          userId: socket.userId,
          status,
          customStatus,
        });

        // Notifier tous les serveurs où l'utilisateur est membre
        const serversResult = await dbManager.queryRegistry(
          'SELECT server_id FROM server_members WHERE user_id = $1',
          [socket.userId]
        );

        const serverIds = serversResult.rows.map((row: any) => row.server_id);
        
        serverIds.forEach((serverId: number) => {
          io.to(`server:${serverId}`).emit('user_status_changed', {
            userId: socket.userId,
            username: socket.username,
            status,
            customStatus,
            statusEmoji,
          });
        });
      } catch (error: any) {
        logger.error('Error updating status', { error: error.message });
        socket.emit('error', { message: 'Failed to update status' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      logger.info('User disconnected', { 
        userId: socket.userId, 
        username: socket.username,
        socketId: socket.id 
      });

      // Mettre le statut à offline
      try {
        await dbManager.queryAuth(
          'UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2',
          ['offline', socket.userId]
        );

        // Notifier les serveurs
        const serversResult = await dbManager.queryRegistry(
          'SELECT server_id FROM server_members WHERE user_id = $1',
          [socket.userId]
        );

        serversResult.rows.forEach((row: any) => {
          io.to(`server:${row.server_id}`).emit('user_status_changed', {
            userId: socket.userId,
            username: socket.username,
            status: 'offline',
          });
        });
      } catch (error: any) {
        logger.error('Error setting offline status', { error: error.message });
      }

      try {
        await dbManager.queryAuth('DELETE FROM sessions WHERE socket_id = $1', [socket.id]);
      } catch (error: any) {
        logger.error('Failed to remove session', { error: error.message });
      }
    });
  });

  logger.info('Socket.io handlers configured');
};
