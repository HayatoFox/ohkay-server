import { Pool } from 'pg';
import logger from './logger';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ohkay',
  user: process.env.DB_USER || 'ohkay_user',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  logger.info('Database connection established');
});

pool.on('error', (err: Error) => {
  logger.error('Unexpected database error', { error: err.message, stack: err.stack });
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: result.rowCount });
    return result;
  } catch (error: any) {
    logger.error('Database query error', { 
      text, 
      error: error.message, 
      stack: error.stack 
    });
    throw error;
  }
};

export const getClient = async () => {
  const client = await pool.connect();
  
  logger.debug('Database client acquired');

  return client;
};

export default pool;
