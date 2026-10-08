#!/usr/bin/env sh
# Gera o .env a partir do .env.example, preenchendo cada segredo com bytes aleatórios.
# Uso: ./scripts/generate-env.sh [--force]
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEMPLATE="$ROOT/.env.example"
TARGET="$ROOT/.env"

if [ -e "$TARGET" ] && [ "${1:-}" != "--force" ]; then
  echo "Já existe um .env. Rode com --force para sobrescrever (os dados do banco usam as senhas antigas!)." >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || { echo "openssl é necessário." >&2; exit 1; }

# 32 bytes aleatórios em base64url, sem padding: seguro para URLs, shell e config do Redis.
rand_token() { openssl rand -base64 48 | tr -d '\n=' | tr '+/' '-_' | cut -c1-48; }
rand_key32() { openssl rand -base64 32 | tr -d '\n'; }

umask 077
tmp=$(mktemp "$ROOT/.env.XXXXXX")
trap 'rm -f "$tmp"' EXIT

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *=\<gerado-base64-32\>) printf '%s=%s\n' "${line%%=*}" "$(rand_key32)" ;;
    *=\<gerado\>)           printf '%s=%s\n' "${line%%=*}" "$(rand_token)" ;;
    *)                      printf '%s\n' "$line" ;;
  esac
done < "$TEMPLATE" > "$tmp"

mv "$tmp" "$TARGET"
trap - EXIT
chmod 600 "$TARGET"
echo ".env gerado em $TARGET (permissão 600). Nunca faça commit deste arquivo."
