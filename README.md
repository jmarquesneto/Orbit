# Plataforma de finanças pessoais (white-label)

Monorepo TypeScript com frontend **Next.js 15**, API **NestJS 12** (Node 22), **PostgreSQL 16** e
**Redis 7**, tudo em Docker. O nome exibido na interface **não está no código**: ele vem da tabela
`system_settings` (chave `app.name`) e pode ser trocado no painel administrativo.

## Subindo o ambiente

Pré-requisitos: Docker com Compose v2 e `openssl`.

```sh
./scripts/generate-env.sh      # cria o .env com segredos aleatórios (permissão 600)
docker compose up -d --build   # constrói e sobe web, api, db e redis
docker compose ps              # os 4 serviços devem ficar "healthy"
```

Acesse <http://localhost:3000>. Só o frontend publica porta, e por padrão apenas em `127.0.0.1`.
Em produção, coloque um proxy reverso com TLS na frente.

Para apagar tudo, inclusive os dados: `docker compose down -v`.

## Estrutura

```
apps/
  api/                    NestJS: um módulo por domínio, em camadas
    src/
      config/             validação do ambiente (Zod), falha rápido no boot
      infrastructure/     adaptadores compartilhados (pool do Postgres, cliente Redis)
      modules/<domínio>/
        domain/           entidades, regras e portas (interfaces), sem framework
        application/      casos de uso: orquestram o domínio pelas portas
        infrastructure/   implementações das portas (SQL, Redis, serviços externos)
        presentation/     controllers HTTP, DTOs e validação de entrada
    test/                 testes HTTP (e2e)
  web/                    Next.js (App Router, saída standalone)
infra/
  db/                     imagem do Postgres + bootstrap de papéis (initdb)
scripts/
  generate-env.sh         gera o .env a partir do .env.example
```

A regra de dependência sempre aponta para dentro: `presentation → application → domain`, e
`infrastructure` implementa as portas definidas em `domain`. Assim, um caso de uso é testado sem
banco, só com portas falsas (veja `modules/health`).

## Segurança da infraestrutura

| Camada | Medida |
| --- | --- |
| Rede | Três redes: `edge` (só o web, com porta publicada), `backend` (web ↔ api, `internal`) e `data` (api ↔ db/redis, `internal`). O banco e o Redis não têm porta no host, não são alcançáveis pelo frontend e não têm saída para a internet. |
| Containers | Usuário não-root, `read_only` com `tmpfs` só onde precisa, `cap_drop: ALL`, `no-new-privileges`, `init: true`, limite de logs. As imagens de runtime não incluem npm, yarn nem corepack. |
| Banco | Três papéis: superusuário (só bootstrap), `app_migrator` (dono do schema, só migrações) e `app_runtime` (API: só DML, sem `BYPASSRLS`, com `statement_timeout`). Autenticação SCRAM-SHA-256. |
| Segredos | O `.env` é gerado com `openssl rand`, tem permissão 600 e é ignorado pelo git e pelo Docker. Cada serviço recebe só as variáveis de que precisa. A API recusa subir com segredo ausente, curto, de exemplo ou repetido. |
| Redis | Senha via stdin (não aparece em `ps`), `protected-mode`, `FLUSHALL`/`FLUSHDB`/`DEBUG` desativados. |
| HTTP | `helmet` na API, limite de 100 kB no corpo JSON, CORS restrito a `WEB_ORIGIN`, cabeçalhos de segurança no frontend (HSTS, `X-Frame-Options`, `nosniff` etc.). |

> Em produção, prefira um cofre de segredos (Docker secrets, AWS Secrets Manager/KMS ou Vault) a
> variáveis de ambiente, que ficam visíveis em `docker inspect`.

## Desenvolvimento local (sem Docker)

```sh
corepack enable
pnpm install
pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

## Endpoints de saúde

| Serviço | Rota | Uso |
| --- | --- | --- |
| api | `GET /health/live` | liveness (healthcheck do Docker) |
| api | `GET /health/ready` | readiness: banco e cache respondem (503 se não) |
| web | `GET /healthz` | liveness do frontend |
