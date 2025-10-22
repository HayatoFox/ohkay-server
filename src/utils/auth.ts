import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const JWT_EXPIRES_IN = '7d';

// Interface pour les requêtes authentifiées
export interface AuthRequest extends Request {
  user?: {
    userId: number;
    username: string;
    id: number; // Alias pour userId (compatibilité)
  };
  // Hérite de Request donc params, query, body, etc. sont disponibles
}

// Middleware d'authentification
export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(403).json({ error: 'Invalid or expired token' });
    return;
  }

  (req as AuthRequest).user = {
    userId: decoded.userId,
    username: decoded.username,
    id: decoded.userId, // Alias
  };
  next();
};

export const hashPassword = async (password: string): Promise<string> => {
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    logger.debug('Password hashed successfully');
    return hash;
  } catch (error: any) {
    logger.error('Password hashing failed', { error: error.message });
    throw error;
  }
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  try {
    const match = await bcrypt.compare(password, hash);
    logger.debug('Password comparison completed', { match });
    return match;
  } catch (error: any) {
    logger.error('Password comparison failed', { error: error.message });
    throw error;
  }
};

export const generateToken = (userId: number, username: string): string => {
  try {
    const token = jwt.sign(
      { userId, username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    logger.debug('JWT token generated', { userId, username });
    return token;
  } catch (error: any) {
    logger.error('Token generation failed', { error: error.message });
    throw error;
  }
};

export const verifyToken = (token: string): { userId: number; username: string } | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
    logger.debug('JWT token verified', { userId: decoded.userId });
    return decoded;
  } catch (error: any) {
    logger.warn('Token verification failed', { error: error.message });
    return null;
  }
};

export const verifyServerPassword = (password: string): boolean => {
  const serverPassword = process.env.SERVER_PASSWORD;
  if (!serverPassword) {
    logger.error('SERVER_PASSWORD not configured');
    return false;
  }
  return password === serverPassword;
};
