-- ============================================================================
-- OHKAY AUTH DATABASE - Authentification & Utilisateurs Globaux
-- ============================================================================

-- Utilisateurs globaux
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP,
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'away', 'dnd', 'offline'))
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- Profils utilisateurs
CREATE TABLE user_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(100),
    avatar_url TEXT,
    bio TEXT,
    banner_color VARCHAR(7), -- Couleur hex #RRGGBB
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions JWT (pour révocation de tokens)
CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45), -- Support IPv6
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Fonction pour nettoyer les sessions expirées
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS void AS $$
BEGIN
    DELETE FROM sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Logs de connexion (optionnel, pour audit)
CREATE TABLE login_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(50),
    success BOOLEAN NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_login_history_user ON login_history(user_id);
CREATE INDEX idx_login_history_created ON login_history(created_at);

-- Trigger pour mettre à jour last_seen
CREATE OR REPLACE FUNCTION update_last_seen() RETURNS TRIGGER AS $$
BEGIN
    UPDATE users SET last_seen = NOW() WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_last_seen
    AFTER INSERT ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_last_seen();

-- Données initiales
-- Le profil sera créé automatiquement à l'inscription
