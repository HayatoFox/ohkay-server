-- ============================================================================
-- OHKAY REGISTRY DATABASE - Registre des Serveurs
-- ============================================================================

-- Métadonnées des serveurs Discord-like
CREATE TABLE servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url TEXT,
    owner_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    is_public BOOLEAN DEFAULT FALSE,
    invite_code VARCHAR(8) UNIQUE, -- Code d'invitation global du serveur
    
    -- Configuration de la base de données dédiée
    db_name VARCHAR(50) UNIQUE NOT NULL, -- Ex: "ohkay_server_1"
    db_host VARCHAR(255) DEFAULT 'localhost',
    db_port INTEGER DEFAULT 5432,
    db_user VARCHAR(50),
    db_password_encrypted TEXT, -- À chiffrer avec crypto
    
    -- Clé de chiffrement pour les messages du serveur (AES-256-GCM)
    encryption_key TEXT NOT NULL, -- Clé base64, générée à la création du serveur
    
    -- Métadonnées
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'archived', 'deleted')),
    max_members INTEGER DEFAULT 1000, -- Limite de membres
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_servers_owner ON servers(owner_id);
CREATE INDEX idx_servers_status ON servers(status);
CREATE INDEX idx_servers_invite_code ON servers(invite_code);
CREATE INDEX idx_servers_name ON servers(name);

-- Membres des serveurs (relation many-to-many)
CREATE TABLE server_members (
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    nickname VARCHAR(100), -- Surnom spécifique au serveur
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (server_id, user_id)
);

CREATE INDEX idx_server_members_user ON server_members(user_id);
CREATE INDEX idx_server_members_server ON server_members(server_id);

-- Bannissements
CREATE TABLE server_bans (
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    reason TEXT,
    banned_by INTEGER NOT NULL, -- FK logique vers auth_db.users
    banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP, -- NULL = permanent
    
    PRIMARY KEY (server_id, user_id)
);

CREATE INDEX idx_server_bans_expires ON server_bans(expires_at);

-- Statistiques des serveurs (pour dashboard)
CREATE TABLE server_stats (
    server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    total_members INTEGER DEFAULT 0,
    total_channels INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    last_activity_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Logs d'audit du registre
CREATE TABLE registry_audit_log (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- 'server_created', 'member_joined', 'server_deleted', etc.
    user_id INTEGER, -- FK logique vers auth_db.users
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_server ON registry_audit_log(server_id);
CREATE INDEX idx_audit_log_action ON registry_audit_log(action);
CREATE INDEX idx_audit_log_created ON registry_audit_log(created_at DESC);

-- Trigger pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_servers_updated_at
    BEFORE UPDATE ON servers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Trigger pour initialiser server_stats
CREATE OR REPLACE FUNCTION init_server_stats() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO server_stats (server_id, total_members)
    VALUES (NEW.id, 1); -- Le créateur est le premier membre
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_init_server_stats
    AFTER INSERT ON servers
    FOR EACH ROW
    EXECUTE FUNCTION init_server_stats();

-- Trigger pour mettre à jour member count
CREATE OR REPLACE FUNCTION update_member_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE server_stats 
        SET total_members = total_members + 1,
            updated_at = NOW()
        WHERE server_id = NEW.server_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE server_stats 
        SET total_members = total_members - 1,
            updated_at = NOW()
        WHERE server_id = OLD.server_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_member_count
    AFTER INSERT OR DELETE ON server_members
    FOR EACH ROW
    EXECUTE FUNCTION update_member_count();

-- Fonction pour générer un code d'invitation unique
CREATE OR REPLACE FUNCTION generate_invite_code() RETURNS VARCHAR(8) AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Pas de I, O, 0, 1 (confusion)
    result VARCHAR(8) := '';
    i INTEGER;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Vue pour les serveurs actifs avec leur stats
CREATE OR REPLACE VIEW active_servers AS
SELECT 
    s.id,
    s.name,
    s.description,
    s.icon_url,
    s.owner_id,
    s.is_public,
    s.created_at,
    st.total_members,
    st.total_channels,
    st.total_messages,
    st.last_activity_at
FROM servers s
LEFT JOIN server_stats st ON s.id = st.server_id
WHERE s.status = 'active';
