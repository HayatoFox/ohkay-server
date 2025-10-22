import { Pool, PoolClient } from 'pg';
import logger from './logger';
import crypto from 'crypto';

// ============================================================================
// MULTI-DATABASE MANAGER
// Gère 3 types de bases de données :
// 1. AUTH_DB - Authentification et utilisateurs globaux
// 2. DM_DB - Messages privés (compte à compte)
// 3. REGISTRY_DB - Registre des serveurs
// 4. SERVER_DBs - Bases de données dynamiques par serveur
// ============================================================================

interface ServerDBConfig {
  serverId: number;
  dbName: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

class DatabaseManager {
  private authPool: Pool;
  private dmPool: Pool;
  private registryPool: Pool;
  private serverPools: Map<number, Pool> = new Map();

  constructor() {
    // Auth Database - Utilisateurs globaux
    this.authPool = new Pool({
      host: process.env.AUTH_DB_HOST || 'auth-db',
      port: parseInt(process.env.AUTH_DB_PORT || '5432'),
      database: process.env.AUTH_DB_NAME || 'ohkay_auth',
      user: process.env.DB_USER || 'ohkay_user',
      password: process.env.DB_PASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.authPool.on('connect', () => {
      logger.info('AUTH_DB connection established');
    });

    this.authPool.on('error', (err: Error) => {
      logger.error('AUTH_DB unexpected error', { error: err.message, stack: err.stack });
    });

    // DM Database - Messages privés
    this.dmPool = new Pool({
      host: process.env.DM_DB_HOST || 'dm-db',
      port: parseInt(process.env.DM_DB_PORT || '5432'),
      database: process.env.DM_DB_NAME || 'ohkay_dms',
      user: process.env.DB_USER || 'ohkay_user',
      password: process.env.DB_PASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.dmPool.on('connect', () => {
      logger.info('DM_DB connection established');
    });

    this.dmPool.on('error', (err: Error) => {
      logger.error('DM_DB unexpected error', { error: err.message, stack: err.stack });
    });

    // Registry Database - Registre des serveurs
    this.registryPool = new Pool({
      host: process.env.REGISTRY_DB_HOST || 'registry-db',
      port: parseInt(process.env.REGISTRY_DB_PORT || '5432'),
      database: process.env.REGISTRY_DB_NAME || 'ohkay_server_registry',
      user: process.env.DB_USER || 'ohkay_user',
      password: process.env.DB_PASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.registryPool.on('connect', () => {
      logger.info('REGISTRY_DB connection established');
    });

    this.registryPool.on('error', (err: Error) => {
      logger.error('REGISTRY_DB unexpected error', { error: err.message, stack: err.stack });
    });

    logger.info('DatabaseManager initialized with multi-DB architecture');
  }

  // ========== AUTH DATABASE ==========
  getAuthDB(): Pool {
    return this.authPool;
  }

  async queryAuth(text: string, params?: any[]) {
    return this.executeQuery('AUTH_DB', this.authPool, text, params);
  }

  async getAuthClient(): Promise<PoolClient> {
    const client = await this.authPool.connect();
    logger.debug('AUTH_DB client acquired');
    return client;
  }

  // ========== DM DATABASE ==========
  getDMDB(): Pool {
    return this.dmPool;
  }

  async queryDM(text: string, params?: any[]) {
    return this.executeQuery('DM_DB', this.dmPool, text, params);
  }

  async getDMClient(): Promise<PoolClient> {
    const client = await this.dmPool.connect();
    logger.debug('DM_DB client acquired');
    return client;
  }

  // ========== REGISTRY DATABASE ==========
  getRegistryDB(): Pool {
    return this.registryPool;
  }

  async queryRegistry(text: string, params?: any[]) {
    return this.executeQuery('REGISTRY_DB', this.registryPool, text, params);
  }

  async getRegistryClient(): Promise<PoolClient> {
    const client = await this.registryPool.connect();
    logger.debug('REGISTRY_DB client acquired');
    return client;
  }

  // ========== SERVER DATABASES (DYNAMIC) ==========
  async getServerDB(serverId: number): Promise<Pool> {
    // Lazy loading - créer la connexion si elle n'existe pas encore
    if (!this.serverPools.has(serverId)) {
      const config = await this.getServerDBConfig(serverId);
      const pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.dbName,
        user: config.user,
        password: config.password,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      pool.on('connect', () => {
        logger.info(`SERVER_DB connection established`, { serverId, dbName: config.dbName });
      });

      pool.on('error', (err: Error) => {
        logger.error(`SERVER_DB unexpected error`, { 
          serverId, 
          dbName: config.dbName, 
          error: err.message, 
          stack: err.stack 
        });
      });

      this.serverPools.set(serverId, pool);
      logger.info(`SERVER_DB pool created`, { serverId, dbName: config.dbName });
    }

    return this.serverPools.get(serverId)!;
  }

  async queryServer(serverId: number, text: string, params?: any[]) {
    const pool = await this.getServerDB(serverId);
    return this.executeQuery(`SERVER_DB_${serverId}`, pool, text, params);
  }

  async getServerClient(serverId: number): Promise<PoolClient> {
    const pool = await this.getServerDB(serverId);
    const client = await pool.connect();
    logger.debug('SERVER_DB client acquired', { serverId });
    return client;
  }

  // Récupérer la configuration d'une base serveur depuis le registre
  private async getServerDBConfig(serverId: number): Promise<ServerDBConfig> {
    const result = await this.registryPool.query(
      `SELECT id, db_name, db_host, db_port, db_user, db_password_encrypted, status 
       FROM servers 
       WHERE id = $1`,
      [serverId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Server ${serverId} not found in registry`);
    }

    const row = result.rows[0];

    if (row.status !== 'active') {
      throw new Error(`Server ${serverId} is not active (status: ${row.status})`);
    }

    return {
      serverId: row.id,
      dbName: row.db_name,
      host: row.db_host,
      port: row.db_port,
      user: row.db_user,
      password: this.decryptPassword(row.db_password_encrypted),
    };
  }

  // Chiffrement/déchiffrement des mots de passe DB
  encryptPassword(password: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.DB_ENCRYPTION_KEY || 'default-key-change-me', 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return `${iv.toString('hex')}:${encrypted}`;
  }

  private decryptPassword(encrypted: string): string {
    // Si pas chiffré (dev), retourner tel quel
    if (!encrypted.includes(':')) {
      return encrypted;
    }

    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.DB_ENCRYPTION_KEY || 'default-key-change-me', 'salt', 32);
    const [ivHex, encryptedText] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  // Helper générique pour exécuter des queries avec logging
  private async executeQuery(dbName: string, pool: Pool, text: string, params?: any[]) {
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Query executed', { 
        db: dbName, 
        duration, 
        rows: result.rowCount,
        query: text.substring(0, 100) // Truncate long queries
      });
      return result;
    } catch (error: any) {
      logger.error('Database query error', {
        db: dbName,
        query: text,
        params,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  // Fermer toutes les connexions
  async closeAll(): Promise<void> {
    logger.info('Closing all database connections...');
    
    await this.authPool.end();
    logger.info('AUTH_DB pool closed');
    
    await this.dmPool.end();
    logger.info('DM_DB pool closed');
    
    await this.registryPool.end();
    logger.info('REGISTRY_DB pool closed');
    
    for (const [serverId, pool] of this.serverPools.entries()) {
      await pool.end();
      logger.info(`SERVER_DB_${serverId} pool closed`);
    }
    
    this.serverPools.clear();
    logger.info('All database connections closed');
  }

  // Vérifier la santé de toutes les connexions
  async healthCheck(): Promise<{ [key: string]: boolean }> {
    const health: { [key: string]: boolean } = {};

    try {
      await this.authPool.query('SELECT 1');
      health.auth_db = true;
    } catch (error) {
      health.auth_db = false;
      logger.error('AUTH_DB health check failed', { error });
    }

    try {
      await this.dmPool.query('SELECT 1');
      health.dm_db = true;
    } catch (error) {
      health.dm_db = false;
      logger.error('DM_DB health check failed', { error });
    }

    try {
      await this.registryPool.query('SELECT 1');
      health.registry_db = true;
    } catch (error) {
      health.registry_db = false;
      logger.error('REGISTRY_DB health check failed', { error });
    }

    return health;
  }
}

// Singleton instance
export const dbManager = new DatabaseManager();

// Backward compatibility exports (deprecated)
export const query = async (text: string, params?: any[]) => {
  logger.warn('DEPRECATED: Use dbManager.queryAuth/queryServer/queryDM instead of query()');
  return dbManager.queryAuth(text, params);
};

export const getClient = async () => {
  logger.warn('DEPRECATED: Use dbManager.getAuthClient/getServerClient/getDMClient instead of getClient()');
  return dbManager.getAuthClient();
};

export default dbManager;
