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

No Windows sem Git Bash, gere o `.env` com
`powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1`.

### Primeiro administrador

As migrações rodam sozinhas a cada `up` (serviço `migrate`). Depois, crie o admin:

```sh
docker compose run --rm api node dist/cli/create-admin.js voce@exemplo.com
```

O comando mostra uma senha aleatória **uma única vez**. Com ela você entra pelo
`POST /api/auth/login`. A tela de login chega junto com o frontend.

## Estrutura

```
apps/
  api/                    NestJS: um módulo por domínio, em camadas
    src/
      config/             validação do ambiente (Zod), falha rápido no boot
      shared/             erros de domínio, portas comuns, validação e filtros HTTP
      infrastructure/     adaptadores compartilhados (Drizzle, Redis, rate limit, migrações)
      cli/                comandos administrativos (ex.: criar o primeiro admin)
      modules/<domínio>/
        domain/           entidades, regras e portas (interfaces), sem framework
        application/      casos de uso: orquestram o domínio pelas portas
        infrastructure/   implementações das portas (SQL, Redis, serviços externos)
        presentation/     controllers HTTP, DTOs e validação de entrada
    drizzle/              migrações SQL versionadas
    test/                 testes dos casos de uso (com portas em memória) e testes HTTP
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

### Testes de integração (Postgres e Redis reais)

Sobem a API inteira contra um banco descartável e conferem, entre outras coisas, o
parcelamento nas faturas, o compartilhamento e o Row-Level Security do próprio Postgres.

```sh
docker compose -p finance-test -f docker-compose.test.yml up -d
pnpm --filter @app/api test:int
docker compose -p finance-test -f docker-compose.test.yml down
```

## Segurança da aplicação

| Tema | Como é feito |
| --- | --- |
| Autenticação | Guard **global**: toda rota exige JWT, exceto as marcadas com `@Public()`. Access token de 15 min (HS256, emissor, audiência e algoritmo fixos) e refresh token opaco de 256 bits, guardado só como SHA-256. |
| Sessão | Tokens em cookies `httpOnly` + `SameSite=Strict` (+ `Secure` quando o site é HTTPS). A cada renovação o refresh muda; se um refresh antigo reaparecer, a família inteira de sessões é revogada. Logout, bloqueio e troca de papel valem na hora, porque o guard confere a sessão e o papel no banco. |
| Senhas | Argon2id (parâmetros OWASP), mínimo de 12 caracteres. Após 5 erros, a conta fica bloqueada por 15 min. Há limite de tentativas por IP e por e-mail (Redis), e o tempo de resposta não revela se o e-mail existe. |
| Papéis | `admin` e `user`. `@Roles('admin')` protege todo o `/api/admin/*`. |
| Convites | Token de 256 bits, guardado só como hash, com validade (padrão de 72 h, configurável) e uso único, consumido numa transação. O link usa `#token`, que não vai para logs nem para o Referer. Qualquer falha devolve a mesma resposta neutra. |
| SQL injection | Todo acesso ao banco passa pelo Drizzle, com consultas parametrizadas. A API usa um papel do Postgres sem DDL. |
| XSS | Entrada validada por schemas Zod estritos (campos desconhecidos são rejeitados). O nome do sistema só aceita letras, números e `. , ' & ( ) -`. A API só responde JSON, com CSP `default-src 'none'`. |
| CSRF | `SameSite=Strict` mais checagem de `Origin`/`Referer` em todo método que altera estado. |
| Auditoria | `audit_logs` só aceita inserção (um trigger bloqueia UPDATE, DELETE e TRUNCATE para qualquer papel) e encadeia SHA-256 (`prev_hash` → `row_hash`), de modo que qualquer adulteração quebra a cadeia. |

## API (Bloco 2)

O navegador acessa a API pelo próprio frontend (`/api/*` é repassado pela rede interna).

| Método e rota | Acesso | O que faz |
| --- | --- | --- |
| `GET /api/branding` | público | nome, cor e logo (white-label) |
| `POST /api/auth/login` | público | `{ email, password }` → cookies de sessão |
| `POST /api/auth/refresh` | público (cookie) | renova a sessão |
| `POST /api/auth/logout` | logado | encerra a sessão |
| `GET /api/auth/me` | logado | usuário atual |
| `POST /api/invitations/inspect` | público | `{ token }` → e-mail do convite |
| `POST /api/invitations/accept` | público | `{ token, password }` → cria a conta e já entra |
| `GET /api/admin/settings` | admin | lista as configurações |
| `PATCH /api/admin/settings/:key` | admin | ex.: `app.name` com `{ "value": "Novo nome" }` |
| `GET /api/admin/invitations` | admin | lista os convites |
| `POST /api/admin/invitations` | admin | `{ email, role?, ttlHours? }` → link do convite |
| `DELETE /api/admin/invitations/:id` | admin | revoga um convite pendente |
| `GET /api/admin/users` | admin | lista os usuários |
| `PATCH /api/admin/users/:id/status` | admin | `{ status: "active" \| "locked" }` |
| `GET /api/health/live` · `/ready` | público | saúde da API |

## API (Bloco 3, motor financeiro)

Todas as rotas exigem login. Valores sempre em **centavos inteiros** (R$ 12,34 → `1234`) e
datas no formato `AAAA-MM-DD`.

| Método e rota | O que faz |
| --- | --- |
| `POST /api/budgets` · `GET /api/budgets` | cria / lista orçamentos (os seus e os compartilhados com você) |
| `GET · PATCH · DELETE /api/budgets/:id` | detalhe / edita / arquiva (arquivar é só do dono) |
| `GET /api/budgets/:id/summary?month=2026-10` | planejado x realizado por categoria no mês |
| `POST · GET /api/budgets/:id/categories` | categorias (receita/despesa, com valor planejado e subcategorias) |
| `PATCH · DELETE /api/budgets/:id/categories/:cid` | edita / exclui categoria |
| `POST · GET /api/budgets/:id/transactions` | lançamentos de conta ou dinheiro (`?month=` filtra) |
| `PATCH /api/budgets/:id/transactions/:tid` | edita (com `version`, lock otimista) |
| `POST /api/budgets/:id/transactions/:tid/payment` | `{ paid, version }` marca ou desmarca o pagamento (mexe no saldo) |
| `POST · GET /api/wallets` | carteiras: `checking`, `cash` ou `credit` (com limite e dias de fechamento e vencimento) |
| `POST /api/wallets/:id/purchases` | compra no cartão em X parcelas → X lançamentos nas faturas dos meses seguintes |
| `DELETE /api/wallets/:id/purchases/:planId` | cancela a compra parcelada inteira |
| `GET /api/wallets/:id/invoices[/2026-11]` | faturas do cartão / uma fatura com as parcelas |
| `POST /api/wallets/:id/invoices/2026-11/payment` | paga a fatura a partir de uma conta |
| `POST · GET /api/goals` · `POST /api/goals/:id/movements` | caixinhas: depósito e resgate a partir de uma carteira |
| `POST /api/shares` · `GET /api/shares` · `DELETE /api/shares/:id` | compartilha orçamento ou caixinha por e-mail, com papel `read`, `edit` ou `create` |

### Regras do motor financeiro

- **Parcelamento:** uma compra no dia em que o cartão fecha (ou depois) já vai para a próxima fatura.
  Os centavos que sobram ficam nas primeiras parcelas, então a soma sempre fecha. Tudo acontece numa
  única transação SQL, e a `idempotencyKey` impede duplicar a compra num clique duplo.
- **Permissões:** em toda requisição, o usuário é comparado com o dono e com `resource_shares`.
  Quem não tem acesso recebe 404 (nem descobre que o recurso existe); quem vê mas não pode
  alterar recebe 403. Só o dono compartilha, exclui e arquiva.
- **Row-Level Security:** o Postgres repete as mesmas regras. Cada transação define
  `app.user_id`, e sem ele nenhuma linha financeira é visível, nem por SQL direto.
- **Carteiras são pessoais:** num orçamento compartilhado, cada pessoa lança e paga com a própria carteira.
