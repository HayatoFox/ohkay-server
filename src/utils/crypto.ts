import crypto from 'crypto';
import logger from './logger';

/**
 * Utilitaires de chiffrement pour les messages et DMs
 * - Chiffrement AES-256-GCM (authenticated encryption)
 * - Chaque serveur a sa propre clé de chiffrement
 * - Les messages sont chiffrés avant stockage en DB
 * - Seule l'application peut déchiffrer (pas l'admin DB)
 */

const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = process.env.MASTER_ENCRYPTION_KEY || 'change-me-32-chars-minimum-prod';

// Vérifier que la clé maître est suffisamment longue
if (MASTER_KEY.length < 32) {
  logger.warn('MASTER_ENCRYPTION_KEY is too short! Use at least 32 characters in production');
}

/**
 * Génère une clé de chiffrement unique pour un serveur
 * Utilisée lors de la création d'un serveur
 */
export function generateServerKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Génère une clé de chiffrement unique pour un utilisateur (DMs)
 * Dérivée du master key + userId
 */
export function deriveUserKey(userId: number): Buffer {
  const salt = `user_${userId}_salt`;
  return crypto.scryptSync(MASTER_KEY, salt, 32);
}

/**
 * Génère une clé de chiffrement pour un serveur à partir de la clé stockée
 */
function parseServerKey(serverKeyBase64: string): Buffer {
  return Buffer.from(serverKeyBase64, 'base64');
}

/**
 * Chiffre un message avec la clé du serveur
 * @param plaintext Message en clair
 * @param serverKeyBase64 Clé du serveur (base64)
 * @returns Message chiffré au format: iv:authTag:ciphertext (base64)
 */
export function encryptMessage(plaintext: string, serverKeyBase64: string): string {
  try {
    const key = parseServerKey(serverKeyBase64);
    const iv = crypto.randomBytes(16); // IV aléatoire pour chaque message
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:ciphertext (tout en base64)
    const result = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
    
    logger.debug('Message encrypted', { 
      plaintextLength: plaintext.length,
      encryptedLength: result.length 
    });
    
    return result;
  } catch (error: any) {
    logger.error('Message encryption failed', { error: error.message });
    throw new Error('Failed to encrypt message');
  }
}

/**
 * Déchiffre un message avec la clé du serveur
 * @param encryptedData Message chiffré (format: iv:authTag:ciphertext)
 * @param serverKeyBase64 Clé du serveur (base64)
 * @returns Message en clair
 */
export function decryptMessage(encryptedData: string, serverKeyBase64: string): string {
  try {
    const key = parseServerKey(serverKeyBase64);
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const [ivBase64, authTagBase64, ciphertext] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    logger.debug('Message decrypted', { 
      encryptedLength: encryptedData.length,
      decryptedLength: decrypted.length 
    });
    
    return decrypted;
  } catch (error: any) {
    logger.error('Message decryption failed', { error: error.message });
    throw new Error('Failed to decrypt message');
  }
}

/**
 * Chiffre un message DM avec la clé de l'utilisateur
 * @param plaintext Message en clair
 * @param userId ID de l'utilisateur
 * @returns Message chiffré
 */
export function encryptDM(plaintext: string, userId: number): string {
  try {
    const key = deriveUserKey(userId);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  } catch (error: any) {
    logger.error('DM encryption failed', { error: error.message });
    throw new Error('Failed to encrypt DM');
  }
}

/**
 * Déchiffre un message DM avec la clé de l'utilisateur
 * @param encryptedData Message chiffré
 * @param userId ID de l'utilisateur
 * @returns Message en clair
 */
export function decryptDM(encryptedData: string, userId: number): string {
  try {
    const key = deriveUserKey(userId);
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted DM format');
    }
    
    const [ivBase64, authTagBase64, ciphertext] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error: any) {
    logger.error('DM decryption failed', { error: error.message });
    throw new Error('Failed to decrypt DM');
  }
}

/**
 * Vérifie si une chaîne est un message chiffré valide
 */
export function isEncrypted(data: string): boolean {
  const parts = data.split(':');
  return parts.length === 3;
}
