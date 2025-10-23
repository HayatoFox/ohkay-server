import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import { PermissionFlags, hasPermission } from '../utils/permissions-flags';
import { getUserChannelPermissions } from './permissions';
import { voiceServer } from '../utils/voice-server';
import logger from '../utils/logger';

const router = Router();

// Obtenir les capacités RTP du router (nécessaire pour WebRTC)
router.get(
  '/:serverId/channels/:channelId/rtp-capabilities',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const userId = req.user?.id;

      // Vérifier permission CONNECT
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
      if (!hasPermission(channelPerms, PermissionFlags.CONNECT)) {
        return res.status(403).json({ error: 'Missing CONNECT permission' });
      }

      // Créer la room si elle n'existe pas
      if (!voiceServer.getRoom(serverId, channelId)) {
        await voiceServer.createRoom(serverId, channelId);
      }

      const rtpCapabilities = voiceServer.getRtpCapabilities(serverId, channelId);

      return res.json({ rtpCapabilities });
    } catch (error: any) {
      logger.error('Error getting RTP capabilities', { error: error.message });
      return res.status(500).json({ error: 'Failed to get RTP capabilities' });
    }
  }
);

// Créer un WebRTC transport
router.post(
  '/:serverId/channels/:channelId/transports',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const userId = req.user?.id;

      // Vérifier permission CONNECT
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
      if (!hasPermission(channelPerms, PermissionFlags.CONNECT)) {
        return res.status(403).json({ error: 'Missing CONNECT permission' });
      }

      const transportParams = await voiceServer.createWebRtcTransport(serverId, channelId);

      logger.info('WebRTC transport created', {
        serverId,
        channelId,
        userId,
        transportId: transportParams.id,
      });

      return res.json(transportParams);
    } catch (error: any) {
      logger.error('Error creating transport', { error: error.message });
      return res.status(500).json({ error: 'Failed to create transport' });
    }
  }
);

// Connecter un transport (DTLS)
router.post(
  '/:serverId/channels/:channelId/transports/:transportId/connect',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const transportId = req.params.transportId;
      const userId = req.user?.id;
      const { dtlsParameters } = req.body;

      // Vérifier permission CONNECT (protection contre replay attack)
      const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
      if (!hasPermission(channelPerms, PermissionFlags.CONNECT)) {
        return res.status(403).json({ error: 'Missing CONNECT permission' });
      }

      await voiceServer.connectTransport(serverId, channelId, transportId, dtlsParameters);

      logger.info('Transport connected', {
        serverId,
        channelId,
        userId,
        transportId,
      });

      return res.json({ message: 'Transport connected' });
    } catch (error: any) {
      logger.error('Error connecting transport', { error: error.message });
      return res.status(500).json({ error: 'Failed to connect transport' });
    }
  }
);

// Lister les peers dans un channel vocal
router.get(
  '/:serverId/channels/:channelId/peers',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);

      const peers = voiceServer.getPeersInRoom(serverId, channelId);

      return res.json({ peers });
    } catch (error: any) {
      logger.error('Error fetching voice peers', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch peers' });
    }
  }
);

// Mute un membre (MUTE_MEMBERS permission)
router.post(
  '/:serverId/channels/:channelId/members/:memberId/mute',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const memberId = parseInt(req.params.memberId);
      const userId = req.user?.id;
      const { muted } = req.body;

      // Vérifier permission MUTE_MEMBERS (sauf pour se muter soi-même)
      if (memberId !== userId) {
        const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
        if (!hasPermission(channelPerms, PermissionFlags.MUTE_MEMBERS)) {
          return res.status(403).json({ error: 'Missing MUTE_MEMBERS permission' });
        }
      }

      await voiceServer.mutePeer(serverId, channelId, memberId, muted);

      logger.info('Member muted', { serverId, channelId, memberId, muted, by: userId });

      return res.json({ message: muted ? 'Member muted' : 'Member unmuted' });
    } catch (error: any) {
      logger.error('Error muting member', { error: error.message });
      return res.status(500).json({ error: 'Failed to mute member' });
    }
  }
);

// Deafen un membre (DEAFEN_MEMBERS permission)
router.post(
  '/:serverId/channels/:channelId/members/:memberId/deafen',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const channelId = parseInt(req.params.channelId);
      const memberId = parseInt(req.params.memberId);
      const userId = req.user?.id;
      const { deafened } = req.body;

      // Vérifier permission DEAFEN_MEMBERS (sauf pour se deafen soi-même)
      if (memberId !== userId) {
        const channelPerms = await getUserChannelPermissions(serverId, channelId, userId!);
        if (!hasPermission(channelPerms, PermissionFlags.DEAFEN_MEMBERS)) {
          return res.status(403).json({ error: 'Missing DEAFEN_MEMBERS permission' });
        }
      }

      await voiceServer.deafenPeer(serverId, channelId, memberId, deafened);

      logger.info('Member deafened', { serverId, channelId, memberId, deafened, by: userId });

      return res.json({ message: deafened ? 'Member deafened' : 'Member undeafened' });
    } catch (error: any) {
      logger.error('Error deafening member', { error: error.message });
      return res.status(500).json({ error: 'Failed to deafen member' });
    }
  }
);

export default router;
