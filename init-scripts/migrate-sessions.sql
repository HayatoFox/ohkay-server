-- ============================================================================
-- Migration: Fix sessions table schema for WebSocket connections
-- ============================================================================

\c ohkay_auth

-- Drop the old sessions table (JWT-based)
DROP TABLE IF EXISTS sessions CASCADE;

-- Create the new sessions table (WebSocket-based)
CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    socket_id VARCHAR(100) UNIQUE NOT NULL,
    ip_address VARCHAR(45), -- Support IPv6
    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_socket ON sessions(socket_id);

-- Recreate the trigger to update last_seen
DROP TRIGGER IF EXISTS trigger_update_last_seen ON sessions;
CREATE TRIGGER trigger_update_last_seen
    AFTER INSERT ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_last_seen();

-- Grant privileges
GRANT ALL ON sessions TO ohkay_user;
GRANT ALL ON sessions_id_seq TO ohkay_user;
