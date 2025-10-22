-- Initialize database schema for Ohkay Server - Multi-Server Architecture

-- Users table (global - utilisateurs de l'instance Ohkay)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'offline',
    custom_status TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Servers table (guilds - serveurs internes à l'instance)
CREATE TABLE IF NOT EXISTS servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url VARCHAR(500),
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    is_public BOOLEAN DEFAULT TRUE,
    invite_code VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Server members (qui est dans quel serveur)
CREATE TABLE IF NOT EXISTS server_members (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    nickname VARCHAR(100),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, user_id)
);

-- Roles (rôles par serveur avec permissions)
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) DEFAULT '#99AAB5',
    position INTEGER DEFAULT 0,
    permissions BIGINT DEFAULT 0,
    is_mentionable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, name)
);

-- Member roles (rôles des membres dans chaque serveur)
CREATE TABLE IF NOT EXISTS member_roles (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, user_id, role_id)
);

-- Channels table (channels appartiennent à un serveur)
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    type VARCHAR(20) DEFAULT 'text',
    position INTEGER DEFAULT 0,
    is_private BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table (messages dans channels OU messages privés)
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    is_private BOOLEAN DEFAULT FALSE,
    recipient_id INTEGER REFERENCES users(id),
    is_edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    edited_at TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Channel members (membres avec accès à un channel privé)
CREATE TABLE IF NOT EXISTS channel_members (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    can_read BOOLEAN DEFAULT TRUE,
    can_write BOOLEAN DEFAULT TRUE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, user_id)
);

-- Sessions table (connexions WebSocket actives)
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    socket_id VARCHAR(100) UNIQUE NOT NULL,
    ip_address VARCHAR(45),
    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Direct message conversations (pour tracker les MPs entre utilisateurs)
CREATE TABLE IF NOT EXISTS dm_conversations (
    id SERIAL PRIMARY KEY,
    user1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    user2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user1_id, user2_id)
);

-- Invitations (pour rejoindre des serveurs)
CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    code VARCHAR(50) UNIQUE NOT NULL,
    created_by INTEGER REFERENCES users(id),
    max_uses INTEGER DEFAULT 0,
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers(owner_id);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_roles_server ON roles(server_id, position);
CREATE INDEX IF NOT EXISTS idx_member_roles_user ON member_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id, position);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(recipient_id) WHERE is_private = TRUE;
CREATE INDEX IF NOT EXISTS idx_channel_members ON channel_members(channel_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_conversations ON dm_conversations(user1_id, user2_id);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);

-- Note: Default server, channel and roles are created programmatically when a user creates their first server
