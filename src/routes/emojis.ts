import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { dbManager } from '../utils/database';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import { PermissionFlags, hasPermission } from '../utils/permissions-flags';
import { getUserPermissions } from './permissions';
import logger from '../utils/logger';

const router = Router();

// Configuration du stockage pour les emojis
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'emojis');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 256 * 1024, // 256 KB max pour les emojis
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/png', 'image/gif', 'image/jpeg', 'image/jpg', 'image/webp'];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non autorisé pour emoji: ${file.mimetype}`));
    }
  }
});

// Créer un emoji custom (MANAGE_EMOJIS_AND_STICKERS)
router.post(
  '/:serverId/emojis',
  authenticateToken,
  checkServerMembership,
  upload.single('image'),
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const userId = req.user?.id;
      const { name } = req.body;

      // Vérifier permission MANAGE_GUILD_EXPRESSIONS ou CREATE_GUILD_EXPRESSIONS
      const userPerms = await getUserPermissions(serverId, userId!);
      if (!hasPermission(userPerms, PermissionFlags.MANAGE_GUILD_EXPRESSIONS) && 
          !hasPermission(userPerms, PermissionFlags.CREATE_GUILD_EXPRESSIONS)) {
        // Supprimer le fichier uploadé
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({ error: 'Missing MANAGE_GUILD_EXPRESSIONS or CREATE_GUILD_EXPRESSIONS permission' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
      }

      if (!name || name.trim().length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Emoji name is required' });
      }

      // Validation du nom (alphanumerique + underscores, 2-32 chars)
      if (!/^[a-zA-Z0-9_]{2,32}$/.test(name)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid emoji name (2-32 alphanumeric characters)' });
      }

      // Vérifier que le nom n'existe pas déjà
      const existingCheck = await dbManager.queryServer(
        serverId,
        'SELECT * FROM emojis WHERE name = $1',
        [name]
      );

      if (existingCheck.rows.length > 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Emoji name already exists' });
      }

      const imageUrl = `/uploads/emojis/${req.file.filename}`;
      const animated = req.file.mimetype === 'image/gif';

      // Insérer l'emoji dans la DB du serveur
      const result = await dbManager.queryServer(
        serverId,
        `INSERT INTO emojis (name, image_url, animated, created_by, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
        [name, imageUrl, animated, userId]
      );

      logger.info('Custom emoji created', {
        serverId,
        userId,
        emojiName: name,
        animated,
      });

      return res.json({ emoji: result.rows[0] });
    } catch (error: any) {
      logger.error('Error creating emoji', { error: error.message });
      return res.status(500).json({ error: 'Failed to create emoji' });
    }
  }
);

// Lister les emojis d'un serveur
router.get(
  '/:serverId/emojis',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);

      const result = await dbManager.queryServer(
        serverId,
        'SELECT * FROM emojis ORDER BY name ASC',
        []
      );

      // Enrichir avec les infos du créateur
      const emojis = await Promise.all(
        result.rows.map(async (emoji: any) => {
          const userResult = await dbManager.queryAuth(
            'SELECT username FROM users WHERE id = $1',
            [emoji.created_by]
          );

          return {
            ...emoji,
            creatorUsername: userResult.rows[0]?.username,
          };
        })
      );

      return res.json({ emojis });
    } catch (error: any) {
      logger.error('Error fetching emojis', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch emojis' });
    }
  }
);

// Supprimer un emoji (MANAGE_EMOJIS_AND_STICKERS)
router.delete(
  '/:serverId/emojis/:emojiId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const emojiId = parseInt(req.params.emojiId);
      const userId = req.user?.id;

      // Vérifier permission MANAGE_GUILD_EXPRESSIONS
      const userPerms = await getUserPermissions(serverId, userId!);
      if (!hasPermission(userPerms, PermissionFlags.MANAGE_GUILD_EXPRESSIONS)) {
        return res.status(403).json({ error: 'Missing MANAGE_GUILD_EXPRESSIONS permission' });
      }

      // Récupérer l'emoji
      const emojiResult = await dbManager.queryServer(
        serverId,
        'SELECT * FROM emojis WHERE id = $1',
        [emojiId]
      );

      if (emojiResult.rows.length === 0) {
        return res.status(404).json({ error: 'Emoji not found' });
      }

      const emoji = emojiResult.rows[0];

      // Supprimer le fichier
      const filePath = path.join(process.cwd(), emoji.image_url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Supprimer de la DB
      await dbManager.queryServer(
        serverId,
        'DELETE FROM emojis WHERE id = $1',
        [emojiId]
      );

      logger.info('Emoji deleted', { serverId, emojiId, userId });

      return res.json({ message: 'Emoji deleted successfully' });
    } catch (error: any) {
      logger.error('Error deleting emoji', { error: error.message });
      return res.status(500).json({ error: 'Failed to delete emoji' });
    }
  }
);

// Modifier un emoji (nom uniquement, MANAGE_EMOJIS_AND_STICKERS)
router.patch(
  '/:serverId/emojis/:emojiId',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const emojiId = parseInt(req.params.emojiId);
      const userId = req.user?.id;
      const { name } = req.body;

      // Vérifier permission MANAGE_GUILD_EXPRESSIONS
      const userPerms = await getUserPermissions(serverId, userId!);
      if (!hasPermission(userPerms, PermissionFlags.MANAGE_GUILD_EXPRESSIONS)) {
        return res.status(403).json({ error: 'Missing MANAGE_GUILD_EXPRESSIONS permission' });
      }

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Emoji name is required' });
      }

      if (!/^[a-zA-Z0-9_]{2,32}$/.test(name)) {
        return res.status(400).json({ error: 'Invalid emoji name' });
      }

      // Vérifier que le nom n'existe pas déjà (sauf pour cet emoji)
      const existingCheck = await dbManager.queryServer(
        serverId,
        'SELECT * FROM emojis WHERE name = $1 AND id != $2',
        [name, emojiId]
      );

      if (existingCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Emoji name already exists' });
      }

      // Mettre à jour
      const result = await dbManager.queryServer(
        serverId,
        'UPDATE emojis SET name = $1 WHERE id = $2 RETURNING *',
        [name, emojiId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Emoji not found' });
      }

      logger.info('Emoji renamed', { serverId, emojiId, newName: name, userId });

      return res.json({ emoji: result.rows[0] });
    } catch (error: any) {
      logger.error('Error updating emoji', { error: error.message });
      return res.status(500).json({ error: 'Failed to update emoji' });
    }
  }
);

// Obtenir les emojis globaux (communs à tous)
router.get(
  '/global',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const { category, search } = req.query;

      let query = 'SELECT * FROM global_emojis';
      const params: any[] = [];
      const conditions: string[] = [];

      if (category) {
        conditions.push(`category = $${params.length + 1}`);
        params.push(category);
      }

      if (search) {
        conditions.push(`(name ILIKE $${params.length + 1} OR $${params.length + 1} = ANY(keywords))`);
        params.push(`%${search}%`);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY name ASC';

      const result = await dbManager.queryAuth(query, params);

      return res.json({ emojis: result.rows });
    } catch (error: any) {
      logger.error('Error fetching global emojis', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch global emojis' });
    }
  }
);

// Obtenir les catégories d'emojis globaux
router.get(
  '/global/categories',
  authenticateToken,
  async (_req: AuthRequest, res: Response) => {
    try {
      const result = await dbManager.queryAuth(
        'SELECT DISTINCT category FROM global_emojis ORDER BY category ASC',
        []
      );

      const categories = result.rows.map((row: any) => row.category);

      return res.json({ categories });
    } catch (error: any) {
      logger.error('Error fetching emoji categories', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch categories' });
    }
  }
);

// Obtenir un emoji spécifique (pour utilisation cross-serveur)
router.get(
  '/:serverId/emojis/:emojiId',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const emojiId = parseInt(req.params.emojiId);
      const userId = req.user?.id;

      // Vérifier si l'utilisateur est membre du serveur source
      const memberCheck = await dbManager.queryRegistry(
        'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
        [serverId, userId]
      );

      const isMember = memberCheck.rows.length > 0;

      // Si pas membre, vérifier permission USE_EXTERNAL_EMOJIS dans le serveur cible
      // (cette vérification sera faite côté client lors de l'envoi du message)

      const result = await dbManager.queryServer(
        serverId,
        'SELECT * FROM emojis WHERE id = $1',
        [emojiId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Emoji not found' });
      }

      return res.json({ 
        emoji: result.rows[0],
        canUse: isMember, // Indique si l'utilisateur peut l'utiliser directement
      });
    } catch (error: any) {
      logger.error('Error fetching emoji', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch emoji' });
    }
  }
);

export default router;
