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

Acesse <http://localhost:3010>. Só o frontend publica porta, e por padrão apenas em `127.0.0.1`.
Em produção, coloque um proxy reverso com TLS na frente.

Para apagar tudo, inclusive os dados: `docker compose down -v`.

No Windows sem Git Bash, gere o `.env` com
`powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1`.

> **NAS com OpenMediaVault?** Siga o guia [deploy/omv/LEIA-ME.md](deploy/omv/LEIA-ME.md)
> (stack do plugin Compose, caminhos absolutos e primeiro acesso sem terminal).

### Primeiro acesso

As migrações rodam sozinhas a cada `up` (serviço `migrate`). Crie o administrador uma vez:

```sh
docker compose run --rm api node dist/cli/create-admin.js voce@exemplo.com "Seu Nome"
```

O comando mostra uma senha aleatória **uma única vez**. Abra <http://localhost:3010> (ou a
porta do seu `.env`), entre com o e-mail e essa senha. No primeiro acesso o sistema pede para
cadastrar a **verificação em duas etapas** (um app autenticador no celular, como Google
Authenticator ou Microsoft Authenticator) e mostra 10 códigos de recuperação: guarde-os. Depois,
siga a ordem:

1. **Orçamentos** → crie um orçamento (ex.: "Pessoal") e as categorias com o valor planejado.
2. **Carteiras** → cadastre sua conta, o dinheiro e os cartões (com os dias de fechamento e vencimento).
3. **Novo lançamento** → registre receitas e despesas; no cartão, escolha o número de parcelas.
4. **Administração** → troque o nome do sistema, a cor e gere convites para outras pessoas.

Perdeu o celular **e** os códigos de recuperação? Outro administrador usa "Redefinir 2 etapas"
na tela de Administração. Se for o único administrador:

```sh
docker compose run --rm api node dist/cli/reset-mfa.js voce@exemplo.com
```

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
| Verificação em duas etapas | TOTP (RFC 6238, 6 dígitos, janela de ±30 s), obrigatória por padrão (`security.mfa_required`). O segredo é cifrado com AES-256-GCM (`DATA_ENCRYPTION_KEY`) e só é gravado depois que o primeiro código confere. Um código já usado não vale de novo. Há 10 códigos de recuperação de uso único, guardados só como hash. Com a senha certa, o login devolve um desafio de 5 min (no máximo 5 tentativas), e só o código o troca pela sessão. Códigos errados contam no mesmo bloqueio da senha. |
| Ações sensíveis | Publicar configurações, criar convites, bloquear usuários e redefinir o MFA de alguém exigem o código confirmado nos últimos 5 minutos nesta sessão. Fora dessa janela, a tela pede o código e repete a ação. |
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
| `GET /api/branding/events` | público | SSE: novo nome, cor e logo assim que o admin publica |
| `POST /api/auth/login` | público | `{ email, password }` → cookies de sessão, ou `{ mfaRequired, challenge }` |
| `POST /api/auth/mfa/verify` | público | `{ challenge, code }` → cookies de sessão (código do app ou de recuperação) |
| `GET /api/auth/mfa` | logado | situação do MFA e códigos de recuperação restantes |
| `POST /api/auth/mfa/setup` · `/enable` | logado | QR code e segredo / `{ code }` ativa e devolve os códigos de recuperação |
| `POST /api/auth/mfa/reauth` | logado | `{ code }` libera ações sensíveis por 5 min |
| `POST /api/auth/mfa/recovery-codes` · `/disable` | logado | `{ code }` gera novos códigos / desativa (se não for obrigatório) |
| `POST /api/auth/refresh` | público (cookie) | renova a sessão |
| `POST /api/auth/logout` | logado | encerra a sessão |
| `GET /api/auth/me` · `PATCH /api/auth/me` | logado | usuário atual / `{ name }` troca o nome de exibição |
| `POST /api/auth/password` | logado | `{ currentPassword, newPassword }` troca a senha e encerra as outras sessões |
| `POST /api/invitations/inspect` | público | `{ token }` → e-mail do convite |
| `POST /api/invitations/accept` | público | `{ token, name, password }` → cria a conta e já entra |
| `GET /api/admin/settings` | admin | lista as configurações |
| `PATCH /api/admin/settings/:key` | admin | ex.: `app.name` com `{ "value": "Novo nome" }` |
| `GET /api/admin/invitations` | admin | lista os convites |
| `POST /api/admin/invitations` | admin | `{ email, name?, role?, ttlHours? }` → link do convite (no endereço que o admin está usando) |
| `DELETE /api/admin/invitations/:id` | admin | revoga um convite pendente |
| `GET /api/admin/users` | admin | lista os usuários |
| `PATCH /api/admin/users/:id/status` | admin | `{ status: "active" \| "locked" }` |
| `POST /api/admin/users/:id/password/reset` | admin | senha provisória (mostrada uma vez); a pessoa cria uma nova no próximo acesso |
| `POST /api/admin/users/:id/mfa/reset` | admin | desativa o MFA da pessoa e encerra as sessões dela |
| `GET /api/health/live` · `/ready` | público | saúde da API |

## Telas

Seguem o canvas de design do projeto (tema escuro, IBM Plex, cor de destaque configurável):
**Login** e **Convite** (públicas); **Visão geral**, **Lançamentos** (lista e novo, com
parcelamento), **Orçamentos** (planejado x realizado, categorias e compartilhamento),
**Carteiras** (com transferências entre contas), **Faturas** (pagar e cancelar compra),
**Caixinhas**, **Conciliação OFX** (com "Escolher outro"), **Segurança** (verificação em duas etapas) e
**Administração** (identidade visual com pré-visualização, convites e usuários).

- **White-label:** o layout raiz lê `GET /api/branding` no servidor a cada requisição. Nome,
  cor e logo entram no `<title>`, no manifest do app, no menu, no login e no convite. As abas
  já abertas ouvem `GET /api/branding/events` (Server-Sent Events via pub/sub do Redis) e trocam
  nome, cor e título na hora, sem recarregar. Uma regra
  de lint (`no-restricted-syntax`) proíbe escrever o nome de fábrica no código do frontend.
- **Sessão:** o navegador nunca vê os tokens (cookies httpOnly). Num 401, o cliente renova a
  sessão uma vez e repete a chamada; se não der, volta para o login.
- **CSP com nonce** por requisição (`middleware.ts`), sem `dangerouslySetInnerHTML`, fontes
  hospedadas localmente (sem Google Fonts em tempo de execução).

## API (Bloco 4, importação OFX)

| Método e rota | O que faz |
| --- | --- |
| `POST /api/ofx/parse` | `multipart` com `file` → JSON padronizado do extrato (não grava nada) |
| `POST /api/ofx/imports` | `file` + `walletId` → importa e concilia com os lançamentos em aberto |
| `GET /api/ofx/imports[/:id]` | importações recentes / uma importação com as linhas |
| `GET /api/ofx/imports/:id/entries/:eid/candidates` | "Escolher outro": lançamentos em aberto da conta (±45 dias), do mais provável ao menos provável |
| `POST /api/ofx/imports/:id/entries/:eid/confirm` | confirma a sugestão ou `{ transactionId }` escolhido (o valor do banco prevalece) |
| `POST /api/ofx/imports/:id/entries/:eid/create` | `{ budgetId, categoryId? }` → cria lançamento pago |
| `POST /api/ofx/imports/:id/entries/:eid/ignore` · `/undo` | ignora / desfaz (o saldo volta) |
| `POST /api/ofx/imports/:id/complete` | conclui a conciliação |

O arquivo (OFX 1.x/SGML ou 2.x/XML, até 5 MB, só em memória) é lido pela biblioteca
**ofx-js** numa *worker thread* sem acesso às variáveis de ambiente, com limite de memória e
tempo. DOCTYPE e ENTITY são recusados (sem XXE). O JSON padronizado traz valores em centavos,
datas ISO, textos saneados e a conta mascarada (4 últimos dígitos). A conciliação pontua cada
linha por valor e data: **automática** (idêntica, aplicada sozinha), **sugestão**, **nova** ou
**duplicada** (FITID já importado). O mesmo arquivo nunca entra duas vezes na mesma conta.

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
| `POST · GET /api/transfers` · `DELETE /api/transfers/:id` | transferência entre contas suas (`{ fromWalletId, toWalletId, amountCents, occurredOn, description? }`) / lista / desfaz. Não conta como receita nem despesa |
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
