import express, { Request, Response, NextFunction } from 'express';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import logger from './utils/logger';
import { dbManager } from './utils/database';
import authRoutes from './routes/auth';
import channelRoutes from './routes/channels';
import serverRoutes from './routes/servers';
import dmRoutes from './routes/dms';
import inviteRoutes from './routes/invites';
import attachmentRoutes from './routes/attachments';
import userRoutes from './routes/users';
import roleRoutes from './routes/roles';
import permissionRoutes from './routes/permissions';
import moderationRoutes from './routes/moderation';
import emojiRoutes from './routes/emojis';
import reactionRoutes from './routes/reactions';
import voiceRoutes from './routes/voice';
import memberRoutes from './routes/members';
import { setupSocketHandlers } from './socket/handlers';
import { voiceServer } from './utils/voice-server';
import { verifyInstancePassword } from './middleware/instanceAuth';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Écouter sur toutes les interfaces

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });
  next();
});

// Instance password protection - appliqué globalement
// Protège /health et toutes les routes API
app.use(verifyInstancePassword);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/dms', dmRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/emojis', emojiRoutes);
app.use('/api/reactions', reactionRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/members', memberRoutes);

// Servir les fichiers uploadés
app.use('/uploads', express.static('uploads'));

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn('404 Not Found', { url: req.url, method: req.method });
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack,
    url: req.url,
    method: req.method,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Setup Socket.io handlers
setupSocketHandlers(io);

// Graceful shutdown
let isShuttingDown = false;
const shutdown = async () => {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  logger.info('Shutting down gracefully...');
  
  // Timeout de sécurité : forcer l'arrêt après 10s max
  const forceShutdownTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  
  try {
    // Arrêter d'accepter de nouvelles connexions
    server.close(() => {
      logger.info('HTTP server closed');
    });
    
    // Fermer Socket.io (déconnecter tous les clients)
    io.close(() => {
      logger.info('Socket.io server closed');
    });
    
    // Fermer le voice server
    await voiceServer.close();
    logger.info('Voice server closed');
    
    // Fermer toutes les connexions DB
    await dbManager.closeAll();
    logger.info('All database pools closed');
    
    clearTimeout(forceShutdownTimer);
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during shutdown', { error: error.message });
    clearTimeout(forceShutdownTimer);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const startServer = async () => {
  try {
    // Test database connections
    const health = await dbManager.healthCheck();
    logger.info('Database health check', health);
    
    if (!health.auth_db || !health.dm_db || !health.registry_db) {
      throw new Error('One or more databases are not healthy');
    }
    
    // Initialize voice server
    await voiceServer.initialize();
    logger.info('Voice server initialized');
    
    // Écouter sur 0.0.0.0 pour accepter les connexions externes
    const port = Number(PORT);
    server.listen(port, HOST, () => {
      logger.info(`Ohkay Server started`, {
        port: port,
        host: HOST,
        env: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
      });
    });
  } catch (error: any) {
    logger.error('Failed to start server', { 
      error: error.message, 
      stack: error.stack 
    });
    process.exit(1);
  }
};

startServer();
