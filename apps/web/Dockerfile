# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do monorepo (veja docker-compose.yml).

ARG NODE_IMAGE=node:22-alpine

# ---------- base ----------
# Dependências e build rodam na arquitetura da MÁQUINA que constrói ($BUILDPLATFORM): a
# saída do Next.js é JavaScript, igual para amd64 e arm64. Assim a imagem arm64 não precisa
# compilar dentro de um emulador (lento e instável). Só o estágio final é da arquitetura alvo.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @app/web...

# ---------- build: saída "standalone" do Next.js ----------
FROM deps AS build
# Destino do proxy /api/* (rede interna do Docker). Entra no build porque o Next.js
# grava as regras de rewrite na saída standalone.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
COPY apps/web apps/web
RUN pnpm --filter @app/web build

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Sem npm/yarn/corepack em runtime: menos superfície de ataque. O PID 1 (init) vem do
# `init: true` do compose, que repassa sinais e recolhe processos zumbis.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# "sharp" (otimização de imagens do Next) é nativo e viria da arquitetura do build; o sistema
# não usa next/image (images.unoptimized), então os binários saem da imagem.
RUN rm -rf /app/node_modules/.pnpm/@img+sharp* /app/node_modules/sharp
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
