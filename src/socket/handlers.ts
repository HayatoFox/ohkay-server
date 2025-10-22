import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/auth';
import { query } from '../utils/database';
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
      await query(
        'INSERT INTO sessions (user_id, socket_id, ip_address) VALUES ($1, $2, $3)',
        [socket.userId, socket.id, socket.handshake.address]
      );
    } catch (error: any) {
      logger.error('Failed to store session', { error: error.message });
    }

    // Join user to their personal room
    socket.join(`user:${socket.userId}`);

    // Handle joining a server
    socket.on('join_server', async (serverId: number) => {
      try {
        // Vérifier que l'utilisateur est membre
        const memberCheck = await query(
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
    socket.on('send_message', async (data: { channelId: number; content: string; serverId?: number }): Promise<void> => {
      try {
        const { channelId, content, serverId } = data;

        if (!content || content.trim().length === 0) {
          socket.emit('error', { message: 'Message content cannot be empty' });
          return;
        }

        // Vérifier l'accès au channel (si serverId fourni)
        if (serverId) {
          const memberCheck = await query(
            'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
            [serverId, socket.userId]
          );

          if (memberCheck.rows.length === 0) {
            socket.emit('error', { message: 'Not authorized to send messages in this server' });
            return;
          }
        }

        const result = await query(
          `INSERT INTO messages (channel_id, user_id, content) 
           VALUES ($1, $2, $3) 
           RETURNING id, channel_id, user_id, content, created_at`,
          [channelId, socket.userId, content]
        );

        const message = result.rows[0];
        const userResult = await query(
          'SELECT username, display_name, avatar_url FROM users WHERE id = $1',
          [socket.userId]
        );

        const fullMessage = {
          ...message,
          ...userResult.rows[0],
        };

        logger.info('Message sent', { 
          messageId: message.id, 
          userId: socket.userId, 
          channelId,
          serverId 
        });

        io.to(`channel:${channelId}`).emit('new_message', fullMessage);
      } catch (error: any) {
        logger.error('Error sending message', { error: error.message, stack: error.stack });
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle private messages
    socket.on('send_private_message', async (data: { recipientId: number; content: string }): Promise<void> => {
      try {
        const { recipientId, content } = data;

        if (!content || content.trim().length === 0) {
          socket.emit('error', { message: 'Message content cannot be empty' });
          return;
        }

        const result = await query(
          `INSERT INTO messages (user_id, recipient_id, content, is_private) 
           VALUES ($1, $2, $3, TRUE) 
           RETURNING id, user_id, recipient_id, content, created_at`,
          [socket.userId, recipientId, content]
        );

        const message = result.rows[0];
        const userResult = await query(
          'SELECT username, display_name, avatar_url FROM users WHERE id = $1',
          [socket.userId]
        );

        const fullMessage = {
          ...message,
          ...userResult.rows[0],
        };

        logger.info('Private message sent', { 
          messageId: message.id, 
          senderId: socket.userId, 
          recipientId 
        });

        // Send to both sender and recipient
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

    // Handle disconnection
    socket.on('disconnect', async () => {
      logger.info('User disconnected', { 
        userId: socket.userId, 
        username: socket.username,
        socketId: socket.id 
      });

      try {
        await query('DELETE FROM sessions WHERE socket_id = $1', [socket.id]);
      } catch (error: any) {
        logger.error('Failed to remove session', { error: error.message });
      }
    });
  });

  logger.info('Socket.io handlers configured');
};
