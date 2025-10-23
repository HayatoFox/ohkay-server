import { Server, Socket } from 'socket.io';
import { dbManager } from '../utils/database';
import { voiceServer } from '../utils/voice-server';
import { PermissionFlags, hasPermission } from '../utils/permissions-flags';
import { getUserChannelPermissions } from '../routes/permissions';
import logger from '../utils/logger';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  username?: string;
}

export const setupVoiceHandlers = (io: Server, socket: AuthenticatedSocket) => {
  // Rejoindre un channel vocal
  socket.on('voice:join', async (data: {
    serverId: number;
    channelId: number;
  }) => {
    try {
      const { serverId, channelId } = data;
      const userId = socket.userId!;
      const username = socket.username!;

      // Vérifier membership
      const memberCheck = await dbManager.queryRegistry(
        'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
        [serverId, userId]
      );

      if (memberCheck.rows.length === 0) {
        socket.emit('voice:error', { message: 'Not a member of this server' });
        return;
      }

      // Vérifier permission CONNECT
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId);
      if (!hasPermission(channelPerms, PermissionFlags.CONNECT)) {
        socket.emit('voice:error', { message: 'Missing CONNECT permission' });
        return;
      }

      // Vérifier permission SPEAK
      const canSpeak = hasPermission(channelPerms, PermissionFlags.SPEAK);

      // Créer la room si elle n'existe pas
      if (!voiceServer.getRoom(serverId, channelId)) {
        await voiceServer.createRoom(serverId, channelId);
      }

      // Rejoindre la room socket.io
      const roomName = `voice:${serverId}:${channelId}`;
      socket.join(roomName);

      // Récupérer la liste des peers actuels
      const peers = voiceServer.getPeersInRoom(serverId, channelId);

      socket.emit('voice:joined', {
        serverId,
        channelId,
        canSpeak,
        peers,
      });

      // Notifier les autres
      socket.to(roomName).emit('voice:peer-joined', {
        userId,
        username,
      });

      logger.info('User joined voice channel', { serverId, channelId, userId, username });
    } catch (error: any) {
      logger.error('Error joining voice channel', { error: error.message });
      socket.emit('voice:error', { message: 'Failed to join voice channel' });
    }
  });

  // Quitter un channel vocal
  socket.on('voice:leave', async (data: {
    serverId: number;
    channelId: number;
  }) => {
    try {
      const { serverId, channelId } = data;
      const userId = socket.userId!;

      const roomName = `voice:${serverId}:${channelId}`;
      socket.leave(roomName);

      await voiceServer.removePeer(serverId, channelId, userId);

      // Notifier les autres
      socket.to(roomName).emit('voice:peer-left', {
        userId,
      });

      socket.emit('voice:left', { serverId, channelId });

      logger.info('User left voice channel', { serverId, channelId, userId });
    } catch (error: any) {
      logger.error('Error leaving voice channel', { error: error.message });
    }
  });

  // Produire de l'audio (commencer à parler)
  socket.on('voice:produce', async (data: {
    serverId: number;
    channelId: number;
    transportId: string;
    kind: 'audio';
    rtpParameters: any;
  }) => {
    try {
      const { serverId, channelId, transportId, kind, rtpParameters } = data;
      const userId = socket.userId!;

      // Vérifier permission SPEAK
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId);
      if (!hasPermission(channelPerms, PermissionFlags.SPEAK)) {
        socket.emit('voice:error', { message: 'Missing SPEAK permission' });
        return;
      }

      const producerId = await voiceServer.produce(
        serverId,
        channelId,
        userId,
        transportId,
        kind,
        rtpParameters
      );

      socket.emit('voice:produced', { producerId });

      // Notifier les autres peers qu'un nouveau producer est disponible
      const roomName = `voice:${serverId}:${channelId}`;
      socket.to(roomName).emit('voice:new-producer', {
        userId,
        producerId,
      });

      logger.info('User started producing audio', { serverId, channelId, userId, producerId });
    } catch (error: any) {
      logger.error('Error producing audio', { error: error.message });
      socket.emit('voice:error', { message: 'Failed to produce audio' });
    }
  });

  // Consommer l'audio d'un autre peer
  socket.on('voice:consume', async (data: {
    serverId: number;
    channelId: number;
    producerUserId: number;
    rtpCapabilities: any;
  }) => {
    try {
      const { serverId, channelId, producerUserId, rtpCapabilities } = data;
      const userId = socket.userId!;

      const consumerParams = await voiceServer.consume(
        serverId,
        channelId,
        userId,
        producerUserId,
        rtpCapabilities
      );

      if (!consumerParams) {
        socket.emit('voice:error', { message: 'Cannot consume this producer' });
        return;
      }

      socket.emit('voice:consumed', {
        producerUserId,
        ...consumerParams,
      });

      logger.debug('User consuming audio', {
        serverId,
        channelId,
        userId,
        producerUserId,
        consumerId: consumerParams.id,
      });
    } catch (error: any) {
      logger.error('Error consuming audio', { error: error.message });
      socket.emit('voice:error', { message: 'Failed to consume audio' });
    }
  });

  // Se mute/unmute soi-même
  socket.on('voice:mute', async (data: {
    serverId: number;
    channelId: number;
    muted: boolean;
  }) => {
    try {
      const { serverId, channelId, muted } = data;
      const userId = socket.userId!;

      await voiceServer.mutePeer(serverId, channelId, userId, muted);

      const roomName = `voice:${serverId}:${channelId}`;
      io.to(roomName).emit('voice:peer-muted', {
        userId,
        muted,
      });

      logger.info('User toggled mute', { serverId, channelId, userId, muted });
    } catch (error: any) {
      logger.error('Error toggling mute', { error: error.message });
      socket.emit('voice:error', { message: 'Failed to toggle mute' });
    }
  });

  // Se deafen/undeafen soi-même
  socket.on('voice:deafen', async (data: {
    serverId: number;
    channelId: number;
    deafened: boolean;
  }) => {
    try {
      const { serverId, channelId, deafened } = data;
      const userId = socket.userId!;

      await voiceServer.deafenPeer(serverId, channelId, userId, deafened);

      const roomName = `voice:${serverId}:${channelId}`;
      io.to(roomName).emit('voice:peer-deafened', {
        userId,
        deafened,
      });

      logger.info('User toggled deafen', { serverId, channelId, userId, deafened });
    } catch (error: any) {
      logger.error('Error toggling deafen', { error: error.message });
      socket.emit('voice:error', { message: 'Failed to toggle deafen' });
    }
  });

  // Déconnexion : quitter tous les channels vocaux
  socket.on('disconnect', async () => {
    // Cette logique sera gérée par le handler principal de disconnect
    // qui itérera sur toutes les rooms vocales pour retirer le peer
  });
};
