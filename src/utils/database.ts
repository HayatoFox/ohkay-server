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

  // ========== CRÉATION DYNAMIQUE DE BASE DE DONNÉES ==========
  /**
   * Crée physiquement une nouvelle base de données PostgreSQL pour un serveur
   * @param dbName Nom de la base de données à créer
   * @param dbUser Utilisateur propriétaire de la DB
   * @returns true si succès
   */
  async createServerDatabase(dbName: string, dbUser: string): Promise<boolean> {
    let adminPool: Pool | null = null;
    
    try {
      logger.info('Creating new server database', { dbName, dbUser });

      // Connexion en tant qu'admin PostgreSQL pour créer la DB
      adminPool = new Pool({
        host: process.env.DB_HOST || process.env.AUTH_DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || process.env.AUTH_DB_PORT || '5432'),
        database: 'postgres', // Base par défaut pour les commandes admin
        user: process.env.DB_ADMIN_USER || process.env.DB_USER || 'postgres',
        password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD,
        max: 1,
        connectionTimeoutMillis: 5000,
      });

      // Vérifier si la DB existe déjà
      const checkResult = await adminPool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName]
      );

      if (checkResult.rows.length > 0) {
        logger.warn('Database already exists', { dbName });
        await adminPool.end();
        return true;
      }

      // Créer la base de données (ne peut pas être dans une transaction)
      await adminPool.query(`CREATE DATABASE ${dbName} OWNER ${dbUser}`);
      logger.info('Database created successfully', { dbName });

      await adminPool.end();
      adminPool = null;

      // Se connecter à la nouvelle DB pour initialiser le schéma
      const newDbPool = new Pool({
        host: process.env.DB_HOST || process.env.AUTH_DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || process.env.AUTH_DB_PORT || '5432'),
        database: dbName,
        user: dbUser,
        password: process.env.DB_PASSWORD,
        max: 1,
        connectionTimeoutMillis: 5000,
      });

      // Appliquer le schéma du template
      await this.initializeServerSchema(newDbPool);
      
      await newDbPool.end();
      
      logger.info('Server database initialized successfully', { dbName });
      return true;

    } catch (error: any) {
      logger.error('Failed to create server database', { 
        dbName, 
        error: error.message, 
        stack: error.stack 
      });
      
      // Cleanup en cas d'erreur
      if (adminPool) {
        try {
          await adminPool.end();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      throw error;
    }
  }

  /**
   * Initialise le schéma d'une nouvelle base de données serveur
   * @param pool Pool de connexion à la DB à initialiser
   */
  private async initializeServerSchema(pool: Pool): Promise<void> {
    logger.info('Initializing server database schema');

    // Schéma complet basé sur server_template.sql
    const schema = `
      -- Channels (texte, vocal, annonces)
      CREATE TABLE channels (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          type VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'voice', 'announcement')),
          position INTEGER DEFAULT 0,
          is_private BOOLEAN DEFAULT FALSE,
          topic TEXT,
          slowmode_seconds INTEGER DEFAULT 0,
          nsfw BOOLEAN DEFAULT FALSE,
          created_by INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_channels_position ON channels(position);
      CREATE INDEX idx_channels_type ON channels(type);

      -- Messages du serveur
      CREATE TABLE messages (
          id SERIAL PRIMARY KEY,
          channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          is_edited BOOLEAN DEFAULT FALSE,
          is_pinned BOOLEAN DEFAULT FALSE,
          reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          edited_at TIMESTAMP,
          deleted_at TIMESTAMP
      );

      CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);
      CREATE INDEX idx_messages_user ON messages(user_id);
      CREATE INDEX idx_messages_deleted ON messages(deleted_at) WHERE deleted_at IS NULL;
      CREATE INDEX idx_messages_pinned ON messages(is_pinned) WHERE is_pinned = TRUE;

      -- Rôles du serveur
      CREATE TABLE roles (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(7),
          position INTEGER DEFAULT 0,
          permissions BIGINT DEFAULT 0,
          is_mentionable BOOLEAN DEFAULT TRUE,
          is_default BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_roles_position ON roles(position DESC);
      CREATE INDEX idx_roles_default ON roles(is_default);

      -- Attribution des rôles aux membres
      CREATE TABLE member_roles (
          user_id INTEGER NOT NULL,
          role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, role_id)
      );

      CREATE INDEX idx_member_roles_user ON member_roles(user_id);
      CREATE INDEX idx_member_roles_role ON member_roles(role_id);

      -- Invitations du serveur
      CREATE TABLE invites (
          id SERIAL PRIMARY KEY,
          code VARCHAR(8) UNIQUE NOT NULL,
          created_by INTEGER NOT NULL,
          max_uses INTEGER DEFAULT 0,
          current_uses INTEGER DEFAULT 0,
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_invites_code ON invites(code);
      CREATE INDEX idx_invites_expires ON invites(expires_at);

      -- Permissions de channel
      CREATE TABLE channel_permissions (
          id SERIAL PRIMARY KEY,
          channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
          user_id INTEGER,
          allow_permissions BIGINT DEFAULT 0,
          deny_permissions BIGINT DEFAULT 0,
          CONSTRAINT check_target CHECK (
              (role_id IS NOT NULL AND user_id IS NULL) OR 
              (role_id IS NULL AND user_id IS NOT NULL)
          )
      );

      CREATE INDEX idx_channel_permissions_channel ON channel_permissions(channel_id);
      CREATE INDEX idx_channel_permissions_role ON channel_permissions(role_id);
      CREATE INDEX idx_channel_permissions_user ON channel_permissions(user_id);

      -- Réactions aux messages
      CREATE TABLE message_reactions (
          message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL,
          emoji VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (message_id, user_id, emoji)
      );

      CREATE INDEX idx_reactions_message ON message_reactions(message_id);

      -- Attachments
      CREATE TABLE message_attachments (
          id SERIAL PRIMARY KEY,
          message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          filename VARCHAR(255) NOT NULL,
          file_url TEXT NOT NULL,
          file_size INTEGER,
          mime_type VARCHAR(100),
          width INTEGER,
          height INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_attachments_message ON message_attachments(message_id);

      -- Webhooks
      CREATE TABLE webhooks (
          id SERIAL PRIMARY KEY,
          channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          avatar_url TEXT,
          token VARCHAR(255) UNIQUE NOT NULL,
          created_by INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_webhooks_channel ON webhooks(channel_id);
      CREATE INDEX idx_webhooks_token ON webhooks(token);

      -- Logs d'audit
      CREATE TABLE audit_log (
          id SERIAL PRIMARY KEY,
          action VARCHAR(50) NOT NULL,
          user_id INTEGER,
          target_id INTEGER,
          target_type VARCHAR(20),
          details JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_audit_log_action ON audit_log(action);
      CREATE INDEX idx_audit_log_user ON audit_log(user_id);
      CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

      -- Fonction pour générer code d'invitation
      CREATE OR REPLACE FUNCTION generate_server_invite_code() RETURNS VARCHAR(8) AS $$
      DECLARE
          chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          result VARCHAR(8) := '';
          i INTEGER;
      BEGIN
          FOR i IN 1..8 LOOP
              result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
          END LOOP;
          RETURN result;
      END;
      $$ LANGUAGE plpgsql;
    `;

    await pool.query(schema);
    logger.info('Server database schema initialized successfully');
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
