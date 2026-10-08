# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do monorepo (veja docker-compose.yml).

ARG NODE_IMAGE=node:22-alpine

# ---------- base: pnpm via corepack ----------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /repo

# ---------- deps: só manifestos, para aproveitar cache de camadas ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @app/api...

# ---------- build: compila e isola só as dependências de produção ----------
FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @app/api build \
 && pnpm --filter @app/api deploy --prod --legacy /out

# ---------- runtime: imagem mínima, sem gerenciadores de pacote, usuário não-root ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    API_PORT=4000
# Sem npm/yarn/corepack em runtime: menos superfície de ataque. O PID 1 (init) vem do
# `init: true` do compose, que repassa sinais e recolhe processos zumbis.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
# Arquivos pertencem ao root e são só-leitura para o usuário "node".
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/drizzle ./drizzle
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
