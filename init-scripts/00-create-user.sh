#!/bin/bash
set -e

# Ce script crée l'utilisateur ohkay_user avec le mot de passe depuis les variables d'environnement
# Il est exécuté en premier par docker-entrypoint-initdb.d (préfixe 00-)

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Créer l'utilisateur ohkay_user si il n'existe pas
    DO \$\$
    BEGIN
       IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ohkay_user') THEN
          CREATE ROLE ohkay_user WITH LOGIN PASSWORD '${DB_PASSWORD}';
       END IF;
    END
    \$\$;
    
    -- Créer les bases de données
    SELECT 'CREATE DATABASE ohkay_auth OWNER ohkay_user'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ohkay_auth')\gexec
    
    SELECT 'CREATE DATABASE ohkay_dms OWNER ohkay_user'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ohkay_dms')\gexec
    
    SELECT 'CREATE DATABASE ohkay_server_registry OWNER ohkay_user'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ohkay_server_registry')\gexec
    
    -- Accorder tous les privilèges
    GRANT ALL PRIVILEGES ON DATABASE ohkay_auth TO ohkay_user;
    GRANT ALL PRIVILEGES ON DATABASE ohkay_dms TO ohkay_user;
    GRANT ALL PRIVILEGES ON DATABASE ohkay_server_registry TO ohkay_user;
EOSQL
