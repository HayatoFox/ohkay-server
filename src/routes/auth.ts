import { Router, Request, Response } from 'express';
import { dbManager } from '../utils/database';
import { hashPassword, comparePassword, generateToken, verifyInstancePassword } from '../utils/auth';
import logger from '../utils/logger';

const router = Router();

// Register new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, instancePassword, displayName } = req.body;

    if (!username || !password || !instancePassword) {
      logger.warn('Registration attempt with missing fields');
      return res.status(400).json({ error: 'Username, password, and instance password are required' });
    }

    // Verify instance password
    if (!verifyInstancePassword(instancePassword)) {
      logger.warn('Registration attempt with invalid instance password', { username });
      return res.status(403).json({ error: 'Invalid instance password' });
    }

    // Check if username already exists
    const existingUser = await dbManager.queryAuth('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      logger.warn('Registration attempt with existing username', { username });
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const result = await dbManager.queryAuth(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, passwordHash]
    );

    const user = result.rows[0];

    // Create profile
    await dbManager.queryAuth(
      'INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)',
      [user.id, displayName || username]
    );

    const token = generateToken(user.id, user.username);

    logger.info('User registered successfully', { userId: user.id, username: user.username });
    
    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: displayName || username,
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
    const { username, password } = req.body;

    if (!username || !password) {
      logger.warn('Login attempt with missing fields');
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user with profile
    const result = await dbManager.queryAuth(
      `SELECT u.*, p.display_name, p.avatar_url 
       FROM users u 
       LEFT JOIN user_profiles p ON u.id = p.user_id 
       WHERE u.username = $1`,
      [username]
    );
    
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
    await dbManager.queryAuth('UPDATE users SET last_seen = CURRENT_TIMESTAMP, status = $1 WHERE id = $2', ['online', user.id]);

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
