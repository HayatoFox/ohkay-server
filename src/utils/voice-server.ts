import * as mediasoup from 'mediasoup';
import { types as mediasoupTypes } from 'mediasoup';
import logger from './logger';

interface VoiceRoom {
  router: mediasoupTypes.Router;
  peers: Map<number, VoicePeer>; // userId -> peer
  channelId: number;
  serverId: number;
}

interface VoicePeer {
  userId: number;
  username: string;
  transport?: mediasoupTypes.WebRtcTransport;
  producer?: mediasoupTypes.Producer;
  consumers: Map<number, mediasoupTypes.Consumer>; // userId -> consumer
  isMuted: boolean;
  isDeafened: boolean;
}

class VoiceServer {
  private worker?: mediasoupTypes.Worker;
  private rooms: Map<string, VoiceRoom> = new Map(); // "serverId:channelId" -> room
  
  async initialize() {
    try {
      // Créer worker mediasoup
      this.worker = await mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: parseInt(process.env.VOICE_RTC_MIN_PORT || '7500'),
        rtcMaxPort: parseInt(process.env.VOICE_RTC_MAX_PORT || '8000'),
      });

      this.worker.on('died', () => {
        logger.error('mediasoup worker died, exiting...');
        process.exit(1);
      });

      logger.info('Voice server initialized', {
        workerPid: this.worker.pid,
        rtcPortRange: `${process.env.VOICE_RTC_MIN_PORT || '7500'}-${process.env.VOICE_RTC_MAX_PORT || '8000'}`,
      });
    } catch (error: any) {
      logger.error('Failed to initialize voice server', { error: error.message });
      throw error;
    }
  }

  async createRoom(serverId: number, channelId: number): Promise<void> {
    const roomId = `${serverId}:${channelId}`;
    
    if (this.rooms.has(roomId)) {
      logger.warn('Voice room already exists', { serverId, channelId });
      return;
    }

    if (!this.worker) {
      throw new Error('Voice worker not initialized');
    }

    const router = await this.worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
          parameters: {
            // Haute qualité audio
            'useinbandfec': 1,        // Forward Error Correction
            'usedtx': 1,              // Discontinuous Transmission (économise bande passante en silence)
            'maxaveragebitrate': 256000, // 256 kbps max (excellente qualité)
            'maxplaybackrate': 48000,
            'stereo': 1,
            'sprop-stereo': 1,
          },
        },
      ],
    });

    this.rooms.set(roomId, {
      router,
      peers: new Map(),
      channelId,
      serverId,
    });

    logger.info('Voice room created', { serverId, channelId, roomId });
  }

  async deleteRoom(serverId: number, channelId: number): Promise<void> {
    const roomId = `${serverId}:${channelId}`;
    const room = this.rooms.get(roomId);

    if (!room) {
      return;
    }

    // Fermer tous les transports et consumers
    for (const peer of room.peers.values()) {
      if (peer.transport) {
        peer.transport.close();
      }
    }

    room.router.close();
    this.rooms.delete(roomId);

    logger.info('Voice room deleted', { serverId, channelId });
  }

  getRoom(serverId: number, channelId: number): VoiceRoom | undefined {
    const roomId = `${serverId}:${channelId}`;
    return this.rooms.get(roomId);
  }

  async createWebRtcTransport(serverId: number, channelId: number): Promise<{
    id: string;
    iceParameters: mediasoupTypes.IceParameters;
    iceCandidates: mediasoupTypes.IceCandidate[];
    dtlsParameters: mediasoupTypes.DtlsParameters;
  }> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      throw new Error('Voice room not found');
    }

    const transport = await room.router.createWebRtcTransport({
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.VOICE_ANNOUNCED_IP || undefined, // IP publique du serveur
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    logger.debug('WebRTC transport created', {
      transportId: transport.id,
      serverId,
      channelId,
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    serverId: number,
    channelId: number,
    _transportId: string,
    dtlsParameters: mediasoupTypes.DtlsParameters
  ): Promise<void> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      throw new Error('Voice room not found');
    }

    // Trouver le peer avec ce transport
    for (const peer of room.peers.values()) {
      if (peer.transport?.id === _transportId) {
        await peer.transport.connect({ dtlsParameters });
        logger.debug('Transport connected', { transportId: _transportId, userId: peer.userId });
        return;
      }
    }

    throw new Error('Transport not found');
  }

  async produce(
    serverId: number,
    channelId: number,
    userId: number,
    _transportId: string,
    kind: mediasoupTypes.MediaKind,
    rtpParameters: mediasoupTypes.RtpParameters
  ): Promise<string> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      throw new Error('Voice room not found');
    }

    const peer = room.peers.get(userId);
    if (!peer || !peer.transport) {
      throw new Error('Peer or transport not found');
    }

    const producer = await peer.transport.produce({
      kind,
      rtpParameters,
    });

    peer.producer = producer;

    logger.info('Producer created', {
      producerId: producer.id,
      userId,
      kind,
      serverId,
      channelId,
    });

    // Notifier les autres peers pour qu'ils consomment ce producer
    this.notifyNewProducer(serverId, channelId, userId, producer.id);

    return producer.id;
  }

  async consume(
    serverId: number,
    channelId: number,
    userId: number,
    producerUserId: number,
    rtpCapabilities: mediasoupTypes.RtpCapabilities
  ): Promise<{
    id: string;
    producerId: string;
    kind: mediasoupTypes.MediaKind;
    rtpParameters: mediasoupTypes.RtpParameters;
  } | null> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      throw new Error('Voice room not found');
    }

    const consumerPeer = room.peers.get(userId);
    const producerPeer = room.peers.get(producerUserId);

    if (!consumerPeer || !consumerPeer.transport || !producerPeer || !producerPeer.producer) {
      return null;
    }

    // Vérifier que le router peut consommer ce producer
    if (!room.router.canConsume({
      producerId: producerPeer.producer.id,
      rtpCapabilities,
    })) {
      return null;
    }

    const consumer = await consumerPeer.transport.consume({
      producerId: producerPeer.producer.id,
      rtpCapabilities,
      paused: false,
    });

    consumerPeer.consumers.set(producerUserId, consumer);

    logger.info('Consumer created', {
      consumerId: consumer.id,
      userId,
      producerUserId,
      serverId,
      channelId,
    });

    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async addPeer(
    serverId: number,
    channelId: number,
    userId: number,
    username: string,
    transport: mediasoupTypes.WebRtcTransport
  ): Promise<void> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      throw new Error('Voice room not found');
    }

    room.peers.set(userId, {
      userId,
      username,
      transport,
      consumers: new Map(),
      isMuted: false,
      isDeafened: false,
    });

    logger.info('Peer added to voice room', { serverId, channelId, userId, username });
  }

  async removePeer(serverId: number, channelId: number, userId: number): Promise<void> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      return;
    }

    const peer = room.peers.get(userId);
    if (!peer) {
      return;
    }

    // Fermer le transport
    if (peer.transport) {
      peer.transport.close();
    }

    // Notifier les autres que ce peer est parti
    this.notifyPeerLeft(serverId, channelId, userId);

    room.peers.delete(userId);

    logger.info('Peer removed from voice room', { serverId, channelId, userId });

    // Si la room est vide, la supprimer après 5 minutes
    if (room.peers.size === 0) {
      setTimeout(() => {
        const currentRoom = this.getRoom(serverId, channelId);
        if (currentRoom && currentRoom.peers.size === 0) {
          this.deleteRoom(serverId, channelId);
        }
      }, 5 * 60 * 1000);
    }
  }

  getPeersInRoom(serverId: number, channelId: number): Array<{ userId: number; username: string; isMuted: boolean; isDeafened: boolean }> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      return [];
    }

    return Array.from(room.peers.values()).map((peer) => ({
      userId: peer.userId,
      username: peer.username,
      isMuted: peer.isMuted,
      isDeafened: peer.isDeafened,
    }));
  }

  async mutePeer(serverId: number, channelId: number, userId: number, muted: boolean): Promise<void> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      throw new Error('Voice room not found');
    }

    const peer = room.peers.get(userId);
    if (!peer) {
      throw new Error('Peer not found');
    }

    peer.isMuted = muted;

    if (peer.producer) {
      if (muted) {
        await peer.producer.pause();
      } else {
        await peer.producer.resume();
      }
    }

    logger.info('Peer muted/unmuted', { serverId, channelId, userId, muted });
  }

  async deafenPeer(serverId: number, channelId: number, userId: number, deafened: boolean): Promise<void> {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      throw new Error('Voice room not found');
    }

    const peer = room.peers.get(userId);
    if (!peer) {
      throw new Error('Peer not found');
    }

    peer.isDeafened = deafened;

    // Pause/resume tous les consumers
    for (const consumer of peer.consumers.values()) {
      if (deafened) {
        await consumer.pause();
      } else {
        await consumer.resume();
      }
    }

    logger.info('Peer deafened/undeafened', { serverId, channelId, userId, deafened });
  }

  getRtpCapabilities(serverId: number, channelId: number): mediasoupTypes.RtpCapabilities {
    const room = this.getRoom(serverId, channelId);
    if (!room) {
      throw new Error('Voice room not found');
    }

    return room.router.rtpCapabilities;
  }

  private notifyNewProducer(_serverId: number, _channelId: number, _userId: number, _producerId: string): void {
    // Cette méthode sera appelée par le socket handler pour notifier les autres clients
    // On émet via socket.io dans voice-handlers.ts
  }

  private notifyPeerLeft(_serverId: number, _channelId: number, _userId: number): void {
    // Idem, notification via socket.io
  }

  async close(): Promise<void> {
    try {
      logger.info('Closing voice server...');
      
      // Fermer toutes les rooms et leurs transports
      for (const [roomKey, room] of this.rooms.entries()) {
        logger.info(`Closing voice room: ${roomKey}`);
        
        // Fermer tous les transports des peers
        for (const peer of room.peers.values()) {
          if (peer.transport) {
            await peer.transport.close();
          }
        }
        
        // Fermer le router
        room.router.close();
      }
      
      this.rooms.clear();
      
      // Fermer le worker
      if (this.worker) {
        this.worker.close();
        logger.info('Voice server worker closed');
      }
      
      logger.info('Voice server closed successfully');
    } catch (error: any) {
      logger.error('Error closing voice server', { error: error.message });
      throw error;
    }
  }
}

export const voiceServer = new VoiceServer();
