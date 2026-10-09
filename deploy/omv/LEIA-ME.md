# Instalar no OpenMediaVault (Compose › Add stack)

Este guia instala o sistema no NAS usando o plugin **Compose** do OpenMediaVault, com
**caminhos absolutos**: o código e os dados ficam numa pasta compartilhada que você enxerga
pelo Windows e que entra no backup do NAS.

```
/srv/dev-disk-by-uuid-XXXX/orbit/        ← pasta compartilhada "orbit"
├── app/                                 ← código (o ZIP do GitHub, extraído)
└── dados/postgres/                      ← banco de dados (criado sozinho)
```

## Antes de começar

- OpenMediaVault 6 ou 7 com **omv-extras** e o plugin **openmediavault-compose** instalados e
  configurados (em *Serviços › Compose › Configurações* já existe uma pasta para os arquivos
  do compose).
- Disco formatado em **ext4** ou **btrfs** (não use NTFS/exFAT para os dados).
- NAS com internet (o primeiro "Up" baixa e compila tudo) e, de preferência, **4 GB de RAM**
  ou mais.
- Um **IP fixo** para o NAS (reserva de DHCP no roteador): o endereço do site depende dele.

## Passo 1 — Criar a pasta "orbit" no NAS

1. *Armazenamento › Pastas compartilhadas › +* → Nome: `orbit` → escolha o disco → Salvar.
2. Na lista, anote o **Caminho absoluto** dessa pasta (algo como
   `/srv/dev-disk-by-uuid-1234abcd/orbit`). Se a coluna não aparecer, ative-a no ícone de
   colunas da tabela.
3. *Serviços › SMB/CIFS › Compartilhamentos › +* → pasta `orbit` → Salvar e aplicar.
   Assim você abre `\\IP-DO-NAS\orbit` pelo Windows.

## Passo 2 — Copiar o código

1. No GitHub, abra o repositório, escolha o branch do projeto e clique em
   **Code › Download ZIP**.
2. Extraia o ZIP no seu PC. Renomeie a pasta extraída para **`app`**.
3. Copie a pasta `app` para `\\IP-DO-NAS\orbit\`. Deve ficar
   `\\IP-DO-NAS\orbit\app\apps`, `\\IP-DO-NAS\orbit\app\deploy`, etc.

## Passo 3 — Gerar a configuração (no Windows)

Na pasta `app` **do seu PC** (a extraída), clique com o botão direito numa área vazia ›
*Abrir no Terminal* (ou PowerShell) e rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1 -Omv
```

O script pergunta:

| Pergunta | Exemplo |
| --- | --- |
| IP do NAS | `192.168.1.50` |
| Porta do site | Enter (usa `3010`) |
| Caminho absoluto da pasta "orbit" | `/srv/dev-disk-by-uuid-1234abcd/orbit` |
| Seu e-mail | será o administrador |
| Seu nome | aparece em "Bom dia, …" |

Ele cria `deploy\omv\orbit.env` com todas as senhas do sistema geradas ao acaso.
**Guarde esse arquivo** (é a chave do banco) e nunca o envie para o GitHub.

## Passo 4 — Criar a stack no OMV

1. *Serviços › Compose › Arquivos › +* (Adicionar).
2. **Nome:** `orbit`.
3. **Arquivo:** cole todo o conteúdo de `deploy/omv/orbit.yml`.
4. **Ambiente (Environment):** cole todo o conteúdo do `orbit.env` gerado no passo 3.
5. Salvar.

## Passo 5 — Subir

Selecione a stack `orbit` e clique em **Up**. Na primeira vez demora (10 a 20 minutos num NAS
comum), porque o código é compilado no próprio NAS.

Ao final, em *Serviços › Compose › Contêineres* devem aparecer `orbit-web-1`, `orbit-api-1`,
`orbit-db-1` e `orbit-redis-1` rodando, e `orbit-migrate-1` **parado (Exited)** — isso é o
normal: ele só prepara o banco e encerra.

## Passo 6 — Primeiro acesso

1. Abra os **logs** do contêiner `orbit-api-1` e procure o quadro **PRIMEIRO ACESSO**: ele
   mostra seu e-mail e uma **senha provisória**.
2. No navegador, abra `http://IP-DO-NAS:3010` e entre com o e-mail e a senha provisória.
3. O sistema pede uma **senha nova** e depois o **app autenticador** no celular (verificação em
   duas etapas). Guarde os códigos de recuperação.

A senha provisória só vale até você criar a sua. Se reiniciar a stack, nada é recriado.

## Backup

Os dados ficam em `.../orbit/dados`. Inclua a pasta `orbit` no backup do NAS e guarde também
o `orbit.env` (sem ele não dá para abrir o banco restaurado). Para uma cópia consistente,
faça o backup com a stack parada (**Down**) ou use o recurso de backup do plugin Compose.

## Problemas comuns

- **"Origem não permitida" ou link de convite com endereço errado:** o `WEB_ORIGIN` no
  Ambiente precisa ser exatamente o endereço que você digita no navegador
  (`http://IP-DO-NAS:3010`). Ajuste, salve e clique em **Up** de novo.
- **Porta 3010 ocupada:** troque `WEB_PORT` e `WEB_ORIGIN` no Ambiente.
- **Perdeu o celular e os códigos de recuperação (e é o único admin):** pelo SSH do NAS rode
  `docker exec orbit-api-1 node dist/cli/reset-mfa.js seu@email.com`.
