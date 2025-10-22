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
import { setupSocketHandlers } from './socket/handlers';

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

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/dms', dmRoutes);

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
const shutdown = async () => {
  logger.info('Shutting down gracefully...');
  
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  io.close(() => {
    logger.info('Socket.io server closed');
  });
  
  await dbManager.closeAll();
  logger.info('All database pools closed');
  
  process.exit(0);
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
    
    server.listen(PORT, () => {
      logger.info(`Ohkay Server started`, {
        port: PORT,
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
