import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { hashPassword, comparePassword, generateToken, verifyServerPassword } from '../utils/auth';
import logger from '../utils/logger';

const router = Router();

// Register new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, serverPassword, displayName } = req.body;

    if (!username || !password || !serverPassword) {
      logger.warn('Registration attempt with missing fields');
      return res.status(400).json({ error: 'Username, password, and server password are required' });
    }

    // Verify server password
    if (!verifyServerPassword(serverPassword)) {
      logger.warn('Registration attempt with invalid server password', { username });
      return res.status(403).json({ error: 'Invalid server password' });
    }

    // Check if username already exists
    const existingUser = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      logger.warn('Registration attempt with existing username', { username });
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const result = await query(
      'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, username, display_name, created_at',
      [username, passwordHash, displayName || username]
    );

    const user = result.rows[0];
    const token = generateToken(user.id, user.username);

    logger.info('User registered successfully', { userId: user.id, username: user.username });
    
    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        createdAt: user.created_at,
      },
    });
  } catch (error: any) {
    logger.error('Registration error', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password, serverPassword } = req.body;

    if (!username || !password || !serverPassword) {
      logger.warn('Login attempt with missing fields');
      return res.status(400).json({ error: 'Username, password, and server password are required' });
    }

    // Verify server password
    if (!verifyServerPassword(serverPassword)) {
      logger.warn('Login attempt with invalid server password', { username });
      return res.status(403).json({ error: 'Invalid server password' });
    }

    // Find user
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      logger.warn('Login attempt with non-existent username', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      logger.warn('Login attempt with invalid password', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last seen
    await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    const token = generateToken(user.id, user.username);

    logger.info('User logged in successfully', { userId: user.id, username: user.username });

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error: any) {
    logger.error('Login error', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
