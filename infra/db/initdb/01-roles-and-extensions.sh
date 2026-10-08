#!/bin/sh
# Cria os papéis da aplicação com privilégio mínimo:
#   - DB_MIGRATOR_USER: dono do schema; só as migrações usam (DDL).
#   - DB_APP_USER:      usado pela API em runtime; apenas DML, sem BYPASSRLS,
#                       para que o Row-Level Security do Bloco 3 valha de fato.
# As senhas são lidas do ambiente com \getenv (nunca passam por argv nem pelo shell).
set -eu

: "${DB_MIGRATOR_USER:?DB_MIGRATOR_USER não definido}"
: "${DB_MIGRATOR_PASSWORD:?DB_MIGRATOR_PASSWORD não definido}"
: "${DB_APP_USER:?DB_APP_USER não definido}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD não definido}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv db POSTGRES_DB
\getenv migrator_user DB_MIGRATOR_USER
\getenv migrator_password DB_MIGRATOR_PASSWORD
\getenv app_user DB_APP_USER
\getenv app_password DB_APP_PASSWORD

-- Extensões previstas no MER: e-mail case-insensitive e funções criptográficas.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE ROLE :"migrator_user" LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 50;

ALTER DATABASE :"db" OWNER TO :"migrator_user";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app_user";

ALTER SCHEMA public OWNER TO :"migrator_user";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_user";

-- Tudo o que o migrador criar fica acessível ao app apenas para DML.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO :"app_user";

-- Limites defensivos para o papel da aplicação.
ALTER ROLE :"app_user" SET statement_timeout = '15s';
ALTER ROLE :"app_user" SET idle_in_transaction_session_timeout = '30s';
SQL
