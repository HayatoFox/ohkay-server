-- ============================================================================
-- OHKAY DM DATABASE - Messages Privés (Compte à Compte)
-- ============================================================================

-- Se connecter à la database dms
\c ohkay_dms

-- Donner tous les privilèges sur le schema public
GRANT ALL ON SCHEMA public TO ohkay_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO ohkay_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ohkay_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ohkay_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ohkay_user;

-- Conversations privées entre 2 utilisateurs
CREATE TABLE IF NOT EXISTS dm_conversations (
    id SERIAL PRIMARY KEY,
    user1_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    user2_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    last_message_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Contrainte pour éviter doublons (1,2) et (2,1)
    CONSTRAINT check_user_order CHECK (user1_id < user2_id),
    CONSTRAINT unique_conversation UNIQUE (user1_id, user2_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_conversations_user1 ON dm_conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user2 ON dm_conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_last_message ON dm_conversations(last_message_at DESC);

-- Messages privés
CREATE TABLE IF NOT EXISTS dm_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    content TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    edited_at TIMESTAMP,
    deleted_at TIMESTAMP -- Soft delete
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation ON dm_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_messages_sender ON dm_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_deleted ON dm_messages(deleted_at) WHERE deleted_at IS NULL;

-- Statut de lecture par utilisateur
CREATE TABLE IF NOT EXISTS dm_read_status (
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, -- FK logique vers auth_db.users
    last_read_message_id INTEGER,
    last_read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_read_status_user ON dm_read_status(user_id);

-- Trigger pour mettre à jour last_message_at
CREATE OR REPLACE FUNCTION update_conversation_last_message() RETURNS TRIGGER AS $$
BEGIN
    UPDATE dm_conversations 
    SET last_message_at = NEW.created_at 
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_last_message
    AFTER INSERT ON dm_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_last_message();

-- Fonction helper pour créer ou récupérer une conversation
CREATE OR REPLACE FUNCTION get_or_create_conversation(
    p_user1_id INTEGER,
    p_user2_id INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_conversation_id INTEGER;
    v_min_user INTEGER;
    v_max_user INTEGER;
BEGIN
    -- S'assurer que user1 < user2
    IF p_user1_id < p_user2_id THEN
        v_min_user := p_user1_id;
        v_max_user := p_user2_id;
    ELSE
        v_min_user := p_user2_id;
        v_max_user := p_user1_id;
    END IF;
    
    -- Chercher conversation existante
    SELECT id INTO v_conversation_id
    FROM dm_conversations
    WHERE user1_id = v_min_user AND user2_id = v_max_user;
    
    -- Si pas trouvée, créer
    IF v_conversation_id IS NULL THEN
        INSERT INTO dm_conversations (user1_id, user2_id)
        VALUES (v_min_user, v_max_user)
        RETURNING id INTO v_conversation_id;
        
        -- Initialiser read_status pour les deux utilisateurs
        INSERT INTO dm_read_status (conversation_id, user_id)
        VALUES 
            (v_conversation_id, v_min_user),
            (v_conversation_id, v_max_user);
    END IF;
    
    RETURN v_conversation_id;
END;
$$ LANGUAGE plpgsql;

-- Vue pour compter les messages non lus par utilisateur
CREATE OR REPLACE VIEW dm_unread_counts AS
SELECT 
    rs.user_id,
    rs.conversation_id,
    COUNT(m.id) AS unread_count
FROM dm_read_status rs
INNER JOIN dm_messages m ON m.conversation_id = rs.conversation_id
WHERE 
    m.sender_id != rs.user_id
    AND m.deleted_at IS NULL
    AND (
        rs.last_read_message_id IS NULL 
        OR m.id > rs.last_read_message_id
    )
GROUP BY rs.user_id, rs.conversation_id;
