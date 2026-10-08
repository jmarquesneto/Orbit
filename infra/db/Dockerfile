# PostgreSQL 16 com bootstrap de papéis de menor privilégio.
ARG POSTGRES_IMAGE=postgres:16-alpine
FROM ${POSTGRES_IMAGE}

# Executados uma única vez, quando o volume de dados está vazio.
COPY --chmod=0755 initdb/ /docker-entrypoint-initdb.d/

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" || exit 1
