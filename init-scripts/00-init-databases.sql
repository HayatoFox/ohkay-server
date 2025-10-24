-- ============================================================================
-- OHKAY - Initialisation des bases de données
-- Ce script crée les bases de données si elles n'existent pas
-- Exécuté en premier (préfixe 00-)
-- Note: L'utilisateur ohkay_user est créé automatiquement via
--       les variables d'environnement Docker (DB_USER et DB_PASSWORD)
-- ============================================================================

-- Créer la base de données auth si elle n'existe pas
SELECT 'CREATE DATABASE ohkay_auth'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ohkay_auth')\gexec

-- Créer la base de données dms si elle n'existe pas
SELECT 'CREATE DATABASE ohkay_dms'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ohkay_dms')\gexec

-- Créer la base de données registry si elle n'existe pas
SELECT 'CREATE DATABASE ohkay_server_registry'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ohkay_server_registry')\gexec
