import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, AuthRequest } from '../utils/auth';
import { checkServerMembership } from '../utils/permissions';
import logger from '../utils/logger';

const router = Router();

// Configuration du stockage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'attachments');
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

// Configuration de multer
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB max
  },
  fileFilter: (_req, file, cb) => {
    // Types autorisés
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      // Vidéos
      'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
      // Documents
      'application/pdf', 'text/plain', 
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Archives
      'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
      // Audio
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non autorisé: ${file.mimetype}`));
    }
  }
});

// Upload un fichier
router.post(
  '/:serverId/upload',
  authenticateToken,
  checkServerMembership,
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const userId = req.user?.id;

      // Vérifier permission ATTACH_FILES
      const { getUserPermissions } = await import('./permissions');
      const { PermissionFlags, hasPermission } = await import('../utils/permissions-flags');
      
      const userPerms = await getUserPermissions(serverId, userId!);
      if (!hasPermission(userPerms, PermissionFlags.ATTACH_FILES)) {
        // Supprimer le fichier uploadé si pas de permission
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({ error: 'Missing ATTACH_FILES permission' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileInfo = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: `/uploads/attachments/${req.file.filename}`,
        type: getFileType(req.file.mimetype),
      };

      logger.info('File uploaded', {
        userId: req.user?.id,
        serverId: req.params.serverId,
        filename: fileInfo.filename,
        type: fileInfo.type,
        size: fileInfo.size,
      });

      return res.json({ file: fileInfo });
    } catch (error: any) {
      logger.error('Error uploading file', { error: error.message });
      return res.status(500).json({ error: 'Failed to upload file' });
    }
  }
);

// Upload multiple fichiers
router.post(
  '/:serverId/upload-multiple',
  authenticateToken,
  checkServerMembership,
  upload.array('files', 10), // Max 10 fichiers
  async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId);
      const userId = req.user?.id;

      // Vérifier permission ATTACH_FILES
      const { getUserPermissions } = await import('./permissions');
      const { PermissionFlags, hasPermission } = await import('../utils/permissions-flags');
      
      const userPerms = await getUserPermissions(serverId, userId!);
      if (!hasPermission(userPerms, PermissionFlags.ATTACH_FILES)) {
        // Supprimer tous les fichiers uploadés
        if (req.files && Array.isArray(req.files)) {
          req.files.forEach((file: any) => {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          });
        }
        return res.status(403).json({ error: 'Missing ATTACH_FILES permission' });
      }

      if (!req.files || (req.files as any[]).length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const filesInfo = (req.files as any[]).map((file: any) => ({
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: `/uploads/attachments/${file.filename}`,
        type: getFileType(file.mimetype),
      }));

      logger.info('Multiple files uploaded', {
        userId: req.user?.id,
        serverId: req.params.serverId,
        count: filesInfo.length,
      });

      return res.json({ files: filesInfo });
    } catch (error: any) {
      logger.error('Error uploading files', { error: error.message });
      return res.status(500).json({ error: 'Failed to upload files' });
    }
  }
);

// Télécharger un fichier
router.get(
  '/download/:filename',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { filename } = req.params;
      const filepath = path.join(process.cwd(), 'uploads', 'attachments', filename);

      if (!fs.existsSync(filepath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Vérifier les permissions (TODO: vérifier que l'utilisateur a accès au serveur du message)

      res.download(filepath);
    } catch (error: any) {
      logger.error('Error downloading file', { error: error.message });
      res.status(500).json({ error: 'Failed to download file' });
    }
  }
);

// Supprimer un fichier
router.delete(
  '/:serverId/:filename',
  authenticateToken,
  checkServerMembership,
  async (req: AuthRequest, res: Response) => {
    try {
      const { filename } = req.params;
      const filepath = path.join(process.cwd(), 'uploads', 'attachments', filename);

      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.info('File deleted', {
          userId: req.user?.id,
          filename,
        });
      }

      return res.json({ message: 'File deleted' });
    } catch (error: any) {
      logger.error('Error deleting file', { error: error.message });
      return res.status(500).json({ error: 'Failed to delete file' });
    }
  }
);

// Helper: déterminer le type de fichier
function getFileType(mimetype: string): 'image' | 'video' | 'gif' | 'file' {
  if (mimetype.startsWith('image/')) {
    return mimetype === 'image/gif' ? 'gif' : 'image';
  }
  if (mimetype.startsWith('video/')) {
    return 'video';
  }
  return 'file';
}

export default router;
