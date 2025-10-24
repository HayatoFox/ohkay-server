-- ============================================================================
-- OHKAY AUTH DATABASE - Authentification & Utilisateurs Globaux
-- ============================================================================

-- Se connecter à la database auth
\c ohkay_auth

-- Utilisateurs globaux
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP,
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'away', 'dnd', 'offline')),
    custom_status TEXT, -- Statut personnalisé ("En train de coder...")
    status_emoji VARCHAR(50) -- Emoji du statut
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Profils utilisateurs
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(100),
    avatar_url TEXT,
    bio TEXT,
    banner_color VARCHAR(7), -- Couleur hex #RRGGBB
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions JWT (pour révocation de tokens)
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45), -- Support IPv6
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Fonction pour nettoyer les sessions expirées
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS void AS $$
BEGIN
    DELETE FROM sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Logs de connexion (optionnel, pour audit)
CREATE TABLE IF NOT EXISTS login_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(50),
    success BOOLEAN NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at);

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

-- Emojis de base (communs à toutes les instances)
CREATE TABLE IF NOT EXISTS global_emojis (
    id SERIAL PRIMARY KEY,
    name VARCHAR(32) NOT NULL UNIQUE, -- Nom de l'emoji (ex: "smile", "heart")
    unicode_char VARCHAR(20), -- Caractère Unicode (ex: "😀", "❤️")
    category VARCHAR(50), -- Catégorie ("smileys", "animals", "food", etc.)
    keywords TEXT[], -- Mots-clés pour recherche
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_global_emojis_name ON global_emojis(name);
CREATE INDEX IF NOT EXISTS idx_global_emojis_category ON global_emojis(category);

-- Données initiales - Emojis de base
INSERT INTO global_emojis (name, unicode_char, category, keywords) VALUES
-- Smileys & Emotion
('smile', '😀', 'smileys', ARRAY['heureux', 'sourire', 'content']),
('laughing', '😆', 'smileys', ARRAY['rire', 'mdr', 'lol']),
('joy', '😂', 'smileys', ARRAY['pleurs', 'rire', 'larmes']),
('heart_eyes', '😍', 'smileys', ARRAY['amour', 'coeur', 'yeux']),
('thinking', '🤔', 'smileys', ARRAY['réflexion', 'penser', 'hmm']),
('thumbsup', '👍', 'smileys', ARRAY['pouce', 'ok', 'bien', 'approuve']),
('thumbsdown', '👎', 'smileys', ARRAY['pouce', 'non', 'mauvais']),
('clap', '👏', 'smileys', ARRAY['applaudir', 'bravo', 'felicitations']),
('fire', '🔥', 'smileys', ARRAY['feu', 'chaud', 'top']),
('rocket', '🚀', 'objects', ARRAY['fusee', 'espace', 'lancement']),

-- Hearts
('heart', '❤️', 'hearts', ARRAY['amour', 'coeur', 'rouge']),
('orange_heart', '🧡', 'hearts', ARRAY['coeur', 'orange']),
('yellow_heart', '💛', 'hearts', ARRAY['coeur', 'jaune']),
('green_heart', '💚', 'hearts', ARRAY['coeur', 'vert']),
('blue_heart', '💙', 'hearts', ARRAY['coeur', 'bleu']),
('purple_heart', '💜', 'hearts', ARRAY['coeur', 'violet']),

-- Animals
('dog', '🐶', 'animals', ARRAY['chien', 'animal']),
('cat', '🐱', 'animals', ARRAY['chat', 'animal']),
('mouse', '🐭', 'animals', ARRAY['souris', 'animal']),
('lion', '🦁', 'animals', ARRAY['animal', 'savane']),
('unicorn', '🦄', 'animals', ARRAY['licorne', 'animal', 'magique']),

-- Food & Drink
('pizza', '🍕', 'food', ARRAY['nourriture', 'italien']),
('hamburger', '🍔', 'food', ARRAY['burger', 'nourriture']),
('fries', '🍟', 'food', ARRAY['frites', 'nourriture']),
('coffee', '☕', 'food', ARRAY['cafe', 'boisson']),
('beer', '🍺', 'food', ARRAY['biere', 'boisson', 'alcool']),
('cake', '🍰', 'food', ARRAY['gateau', 'dessert']),

-- Activities
('soccer', '⚽', 'activities', ARRAY['foot', 'football', 'sport']),
('basketball', '🏀', 'activities', ARRAY['basket', 'sport']),
('video_game', '🎮', 'activities', ARRAY['jeu', 'gaming', 'manette']),
('musical_note', '🎵', 'activities', ARRAY['musique', 'note']),

-- Symbols
('check', '✅', 'symbols', ARRAY['valide', 'ok', 'fait', 'correct']),
('x', '❌', 'symbols', ARRAY['non', 'erreur', 'faux', 'croix']),
('warning', '⚠️', 'symbols', ARRAY['attention', 'alerte']),
('question', '❓', 'symbols', ARRAY['interrogation', 'pourquoi']),
('exclamation', '❗', 'symbols', ARRAY['exclamation', 'important']),
('star', '⭐', 'symbols', ARRAY['etoile', 'favori']),
('sparkles', '✨', 'symbols', ARRAY['etincelles', 'brillant']),

-- Objects
('computer', '💻', 'objects', ARRAY['ordinateur', 'pc', 'informatique']),
('phone', '📱', 'objects', ARRAY['telephone', 'mobile']),
('book', '📖', 'objects', ARRAY['livre', 'lire']),
('pencil', '✏️', 'objects', ARRAY['crayon', 'ecrire']),
('bulb', '💡', 'objects', ARRAY['ampoule', 'idee', 'lumiere']),

-- Flags (quelques-uns)
('flag_fr', '🇫🇷', 'flags', ARRAY['france', 'drapeau']),
('flag_us', '🇺🇸', 'flags', ARRAY['usa', 'amerique', 'drapeau']),
('flag_gb', '🇬🇧', 'flags', ARRAY['uk', 'angleterre', 'drapeau']),
('flag_de', '🇩🇪', 'flags', ARRAY['allemagne', 'drapeau']),
('flag_es', '🇪🇸', 'flags', ARRAY['espagne', 'drapeau']);

-- Données initiales
-- Le profil sera créé automatiquement à l'inscription
