#!/bin/bash
set -e

# Ce script s'exécute automatiquement lors de l'initialisation du conteneur PostgreSQL
# Il crée les bases de données initiales et l'utilisateur ohkay_user

echo "🔧 Initializing Ohkay PostgreSQL databases..."

# Variables d'environnement
DB_USER="${DB_USER:-ohkay_user}"
DB_PASSWORD="${DB_PASSWORD:-changeme}"

# Créer l'utilisateur ohkay_user s'il n'existe pas
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    -- Créer l'utilisateur
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$DB_USER') THEN
            CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
        END IF;
    END
    \$\$;
    
    -- Donner les permissions nécessaires
    ALTER USER $DB_USER CREATEDB;
    
    GRANT ALL PRIVILEGES ON DATABASE postgres TO $DB_USER;
EOSQL

echo "✅ User '$DB_USER' created/verified"

# Créer les bases de données principales
databases=("ohkay_auth" "ohkay_dms" "ohkay_server_registry")

for db in "${databases[@]}"; do
    echo "📦 Creating database: $db"
    
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
        -- Créer la base si elle n'existe pas
        SELECT 'CREATE DATABASE $db OWNER $DB_USER'
        WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db')\gexec
        
        -- Donner tous les privilèges
        GRANT ALL PRIVILEGES ON DATABASE $db TO $DB_USER;
EOSQL

    echo "✅ Database '$db' created/verified"
done

# Initialiser le schéma de auth_db
echo "📝 Initializing auth_db schema..."
psql -v ON_ERROR_STOP=1 --username "$DB_USER" --dbname "ohkay_auth" < /docker-entrypoint-initdb.d/auth.sql
echo "✅ auth_db schema initialized"

# Initialiser le schéma de dm_db
echo "📝 Initializing dm_db schema..."
psql -v ON_ERROR_STOP=1 --username "$DB_USER" --dbname "ohkay_dms" < /docker-entrypoint-initdb.d/dms.sql
echo "✅ dm_db schema initialized"

# Initialiser le schéma de registry_db
echo "📝 Initializing registry_db schema..."
psql -v ON_ERROR_STOP=1 --username "$DB_USER" --dbname "ohkay_server_registry" < /docker-entrypoint-initdb.d/registry.sql
echo "✅ registry_db schema initialized"

echo "🎉 All Ohkay databases initialized successfully!"
