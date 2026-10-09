# Instalar no OpenMediaVault (Compose › Adicionar)

Instalação com **imagens prontas** do GitHub (`ghcr.io/jmarquesneto/orbit-*`), no mesmo
estilo de outros apps do NAS: um único arquivo de stack, com o **caminho absoluto** dos
dados escrito nele. O NAS não precisa do código nem compila nada.

## Antes de começar

- OpenMediaVault com **omv-extras** e o plugin **openmediavault-compose**.
- Disco dos dados em **ext4** ou **btrfs** (não NTFS/exFAT).
- **IP fixo** para o NAS (reserva de DHCP no roteador).

## Passo 1 — Gerar o arquivo da stack (no Windows)

1. No GitHub, **Code › Download ZIP** e extraia no seu PC (só para usar o script).
2. Dentro da pasta extraída, abra o PowerShell e rode:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1 -Omv
   ```

3. Responda:

   | Pergunta | Exemplo |
   | --- | --- |
   | IP do NAS | `192.168.1.50` |
   | Porta do site | Enter (usa `3010`) |
   | Caminho absoluto dos dados | `/srv/dev-disk-by-uuid-2d41…07be/docker_app/orbit` |
   | Seu e-mail | será o administrador |
   | Seu nome | aparece em "Bom dia, …" |

O script cria **`deploy\omv\orbit-pronto.yml`** com tudo preenchido, inclusive as senhas
do sistema, geradas ao acaso. **Guarde uma cópia desse arquivo** e não publique.

> O caminho absoluto do disco aparece em *Armazenamento › Pastas compartilhadas*
> (coluna "Caminho absoluto"). A pasta `orbit` não precisa existir: é criada sozinha.

## Passo 2 — Criar a stack

1. *Serviços › Compose › Arquivos › +* (Adicionar).
2. **Nome:** `orbit`.
3. **Arquivo:** cole todo o conteúdo do `orbit-pronto.yml`. O campo de ambiente fica vazio.
4. Salvar, selecionar a stack e clicar em **Up**.

Em *Contêineres* devem aparecer `orbit-web-1`, `orbit-api-1`, `orbit-db-1` e
`orbit-redis-1` rodando, e `orbit-migrate-1` **parado (Exited)** — isso é o normal.

## Passo 3 — Primeiro acesso

1. Abra o **log** do contêiner `orbit-api-1` e procure o quadro **PRIMEIRO ACESSO**:
   ele mostra seu e-mail e uma **senha provisória**.
2. Abra `http://IP-DO-NAS:3010` e entre com essa senha.
3. O sistema pede uma **senha nova** e o **app autenticador** no celular. Guarde os
   códigos de recuperação.

## Atualizar

Quando sair uma versão nova: selecione a stack › **Pull** › **Up**. Os dados ficam na
pasta do disco e não são afetados.

## Backup

Faça backup da pasta de dados (`.../orbit/postgres`) com a stack parada (**Down**) e guarde
o `orbit-pronto.yml` — sem as senhas dele não dá para abrir o banco restaurado.

## Problemas comuns

- **"Origem não permitida":** o endereço no navegador precisa ser o mesmo do `WEB_ORIGIN`
  no arquivo (`http://IP-DO-NAS:3010`). Corrija o IP no arquivo da stack e clique em **Up**.
- **Porta ocupada:** troque a porta nas duas linhas (`ports` e `WEB_ORIGIN`).
- **Perdeu o celular e os códigos de recuperação (único admin):** pelo SSH do NAS,
  `docker exec orbit-api-1 node dist/cli/reset-mfa.js seu@email.com`.
