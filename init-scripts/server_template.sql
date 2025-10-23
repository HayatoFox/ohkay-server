-- ============================================================================
-- OHKAY SERVER DATABASE TEMPLATE
-- À utiliser pour chaque nouveau serveur (ohkay_server_1, ohkay_server_2, etc.)
-- ============================================================================

-- Channels (texte, vocal, annonces)
CREATE TABLE channels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    type VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'voice', 'announcement')),
    position INTEGER DEFAULT 0, -- Ordre d'affichage
    is_private BOOLEAN DEFAULT FALSE, -- Channel privé (visible seulement pour certains rôles)
    topic TEXT, -- Sujet du channel
    slowmode_seconds INTEGER DEFAULT 0, -- Temps entre messages (anti-spam)
    nsfw BOOLEAN DEFAULT FALSE,
    created_by INTEGER NOT NULL, -- user_id de auth_db
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_channels_position ON channels(position);
CREATE INDEX idx_channels_type ON channels(type);

-- Messages du serveur
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    content TEXT NOT NULL, -- Chiffré (texte ou métadata JSON)
    message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'file', 'image', 'video', 'gif')),
    is_edited BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL, -- Réponse à un message
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    edited_at TIMESTAMP,
    deleted_at TIMESTAMP -- Soft delete
);

CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_deleted ON messages(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_pinned ON messages(is_pinned) WHERE is_pinned = TRUE;

-- Rôles du serveur
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7), -- Couleur hex #RRGGBB
    position INTEGER DEFAULT 0, -- Hiérarchie (plus élevé = plus de pouvoir)
    permissions VARCHAR(20) DEFAULT '0', -- Bitfield 64-bit stocké en string
    is_mentionable BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE, -- Rôle @everyone
    is_hoisted BOOLEAN DEFAULT FALSE, -- Affiché séparément
    icon_url TEXT, -- Icône du rôle (premium)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_roles_position ON roles(position DESC);
CREATE INDEX idx_roles_default ON roles(is_default);

-- Attribution des rôles aux membres
CREATE TABLE member_roles (
    user_id INTEGER NOT NULL, -- FK logique vers auth_db.users
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
    created_by INTEGER NOT NULL, -- user_id de auth_db
    max_uses INTEGER DEFAULT 0, -- 0 = illimité
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMP, -- NULL = jamais
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invites_code ON invites(code);
CREATE INDEX idx_invites_expires ON invites(expires_at);

-- Permissions de channel (override par rôle ou utilisateur)
CREATE TABLE channel_permissions (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    user_id INTEGER, -- FK logique vers auth_db.users (NULL si override par rôle)
    allow_permissions VARCHAR(20) DEFAULT '0', -- Permissions accordées (bigint en string)
    deny_permissions VARCHAR(20) DEFAULT '0', -- Permissions refusées (bigint en string)
    
    CONSTRAINT check_target CHECK (
        (role_id IS NOT NULL AND user_id IS NULL) OR 
        (role_id IS NULL AND user_id IS NOT NULL)
    ),
    
    CONSTRAINT unique_channel_target UNIQUE (channel_id, role_id, user_id)
);

CREATE INDEX idx_channel_permissions_channel ON channel_permissions(channel_id);
CREATE INDEX idx_channel_permissions_role ON channel_permissions(role_id);
CREATE INDEX idx_channel_permissions_user ON channel_permissions(user_id);

-- Réactions aux messages (emojis)
CREATE TABLE message_reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    emoji VARCHAR(100) NOT NULL, -- Unicode emoji ou custom emoji ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);

-- Attachments (fichiers joints aux messages)
CREATE TABLE message_attachments (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_size INTEGER, -- Taille en bytes
    mime_type VARCHAR(100),
    width INTEGER, -- Pour images
    height INTEGER, -- Pour images
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_attachments_message ON message_attachments(message_id);

-- Webhooks (pour intégrations)
CREATE TABLE webhooks (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    token VARCHAR(255) UNIQUE NOT NULL,
    created_by INTEGER NOT NULL, -- user_id
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhooks_channel ON webhooks(channel_id);
CREATE INDEX idx_webhooks_token ON webhooks(token);

-- Emojis custom du serveur
CREATE TABLE emojis (
    id SERIAL PRIMARY KEY,
    name VARCHAR(32) NOT NULL UNIQUE, -- Nom de l'emoji (ex: "party_parrot")
    image_url TEXT NOT NULL, -- URL de l'image
    animated BOOLEAN DEFAULT FALSE, -- GIF ou statique
    created_by INTEGER NOT NULL, -- user_id qui a créé l'emoji
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_emojis_name ON emojis(name);
CREATE INDEX idx_emojis_created_by ON emojis(created_by);

-- Bans du serveur
CREATE TABLE bans (
    user_id INTEGER PRIMARY KEY, -- FK logique vers auth_db.users
    banned_by INTEGER NOT NULL, -- FK logique vers auth_db.users (qui a banni)
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bans_created ON bans(created_at DESC);

-- Logs d'audit du serveur
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL, -- 'MEMBER_KICK', 'MEMBER_BAN', 'MESSAGE_DELETE', 'CHANNEL_CREATE', etc.
    user_id INTEGER, -- FK logique vers auth_db.users (qui a fait l'action)
    target_user_id INTEGER, -- Pour actions sur users
    target_channel_id INTEGER, -- Pour actions sur channels
    target_role_id INTEGER, -- Pour actions sur roles
    reason TEXT,
    details JSONB, -- Données supplémentaires
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

-- Trigger pour incrémenter current_uses lors de l'utilisation d'une invitation
CREATE OR REPLACE FUNCTION increment_invite_usage() RETURNS TRIGGER AS $$
BEGIN
    UPDATE invites 
    SET current_uses = current_uses + 1 
    WHERE code = NEW.invite_code;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: Ce trigger sera créé dans registry_db, pas ici

-- Fonction pour générer code d'invitation unique au serveur
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

-- Données initiales pour chaque nouveau serveur
-- Channel "general" et rôle "@everyone" seront créés via l'API
