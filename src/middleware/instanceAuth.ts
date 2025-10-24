import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Middleware pour vérifier le mot de passe d'instance
 * Protège l'accès à l'instance avec un mot de passe global
 * Le client doit envoyer le header X-Instance-Password
 */
export const verifyInstancePassword = (req: Request, res: Response, next: NextFunction) => {
  const instancePassword = process.env.INSTANCE_PASSWORD;
  
  // Si aucun mot de passe n'est configuré, on passe
  if (!instancePassword) {
    logger.warn('INSTANCE_PASSWORD not set - instance is unprotected!');
    return next();
  }

  const providedPassword = req.headers['x-instance-password'] as string;

  if (!providedPassword) {
    logger.warn('Instance access attempt without password', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent')
    });
    return res.status(401).json({ 
      error: 'Instance password required',
      message: 'This instance requires a password. Please provide X-Instance-Password header.' 
    });
  }

  if (providedPassword !== instancePassword) {
    logger.warn('Instance access attempt with invalid password', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent')
    });
    return res.status(403).json({ 
      error: 'Invalid instance password',
      message: 'The provided instance password is incorrect.' 
    });
  }

  // Mot de passe correct
  logger.debug('Instance password verified successfully', {
    ip: req.ip,
    path: req.path
  });
  
  next();
};
