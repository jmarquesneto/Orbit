# Gera a configuração com senhas aleatórias criptograficamente seguras (PowerShell 5.1+).
#
#   Docker Desktop (este PC):   powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1 [-Force]
#       → cria o .env a partir do .env.example
#
#   OpenMediaVault (NAS):       powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1 -Omv [-Force]
#       → pergunta IP, porta, pasta e e-mail e cria deploy\omv\orbit-pronto.yml,
#         o arquivo completo para colar em Serviços › Compose › Arquivos › Adicionar.
param([switch]$Force, [switch]$Omv)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if ($Omv) {
  $template = Join-Path $root 'deploy/omv/orbit.yml'
  $target = Join-Path $root 'deploy/omv/orbit-pronto.yml'
} else {
  $template = Join-Path $root '.env.example'
  $target = Join-Path $root '.env'
}

if ((Test-Path $target) -and -not $Force) {
  Write-Error "Ja existe $target. Use -Force para sobrescrever (um banco ja criado continua usando as senhas antigas!)."
}

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-RandomBytes([int]$count) {
  $bytes = New-Object byte[] $count
  $rng.GetBytes($bytes)
  return $bytes
}
# 36 bytes -> 48 caracteres base64url, sem padding (seguro para URL, shell, YAML e Redis).
function New-Token { ([Convert]::ToBase64String((New-RandomBytes 36))).Replace('+', '-').Replace('/', '_').TrimEnd('=') }
function New-Key32 { [Convert]::ToBase64String((New-RandomBytes 32)) }

if ($Omv) {
  Write-Host ''
  Write-Host 'Configuracao para o OpenMediaVault. Responda e tecle Enter.' -ForegroundColor Cyan
  Write-Host ''
  $hostAddr = (Read-Host 'IP do NAS na rede (ex.: 192.168.1.50)').Trim()
  if ($hostAddr -notmatch '^[A-Za-z0-9.-]+$') { Write-Error 'Informe so o IP ou o nome do NAS, sem http:// nem porta.' }
  $port = (Read-Host 'Porta do site [3010]').Trim()
  if (-not $port) { $port = '3010' }
  if ($port -notmatch '^\d{2,5}$') { Write-Error 'Porta invalida.' }
  Write-Host ''
  Write-Host 'Caminho ABSOLUTO onde o banco de dados vai ficar no NAS.' -ForegroundColor Cyan
  Write-Host 'Ex.: /srv/dev-disk-by-uuid-2d416577-b106-48d3-ac0c-cb89507d07be/docker_app/orbit'
  $dataDir = (Read-Host 'Caminho').Trim().TrimEnd('/')
  if (-not $dataDir.StartsWith('/') -or $dataDir -match '\s') {
    Write-Error 'O caminho precisa comecar com "/" e nao pode ter espacos (e o caminho do Linux do NAS, nao do Windows).'
  }
  Write-Host ''
  $email = (Read-Host 'Seu e-mail (sera o administrador)').Trim()
  if ($email -notmatch '^[^@\s"]+@[^@\s"]+\.[^@\s"]+$') { Write-Error 'E-mail invalido.' }
  $name = (Read-Host 'Seu nome (como quer ser chamado)').Trim()
  if ($name -match '["\\]') { Write-Error 'O nome nao pode ter aspas nem barra invertida.' }

  $values = @{
    '__IP_DO_NAS__'               = $hostAddr
    '__PORTA__'                   = $port
    '__PASTA_DADOS__'             = $dataDir
    '__EMAIL_ADMIN__'             = $email
    '__NOME_ADMIN__'              = $name
    '__DB_SUPERUSER_PASSWORD__'   = New-Token
    '__DB_MIGRATOR_PASSWORD__'    = New-Token
    '__DB_APP_PASSWORD__'         = New-Token
    '__REDIS_PASSWORD__'          = New-Token
    '__JWT_ACCESS_SECRET__'       = New-Token
    '__JWT_REFRESH_SECRET__'      = New-Token
    '__SESSION_SECRET__'          = New-Token
    '__DATA_ENCRYPTION_KEY__'     = New-Key32
  }
  $text = [System.IO.File]::ReadAllText($template)
  foreach ($key in $values.Keys) { $text = $text.Replace($key, $values[$key]) }
  if ($text -match '__[A-Z_]+__') { Write-Error "Ficou um valor sem preencher: $($Matches[0])" }
  $header = "# GERADO EM $(Get-Date -Format 'yyyy-MM-dd HH:mm') - contem as senhas do sistema. Guarde uma copia e nao publique.`n"
  [System.IO.File]::WriteAllText($target, $header + $text.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))

  Write-Host ''
  Write-Host "Arquivo gerado: $target" -ForegroundColor Green
  Write-Host 'Abra com o Bloco de Notas, copie TUDO e cole no campo "Arquivo" da stack no OMV.'
  Write-Host "Depois de subir, abra http://${hostAddr}:$port"
  exit 0
}

$lines = foreach ($line in [System.IO.File]::ReadAllLines($template)) {
  if ($line -match '^([A-Z0-9_]+)=<gerado-base64-32>$') { "$($Matches[1])=$(New-Key32)" }
  elseif ($line -match '^([A-Z0-9_]+)=<gerado>$') { "$($Matches[1])=$(New-Token)" }
  else { $line }
}
# UTF-8 sem BOM e quebras LF, como o docker compose espera.
[System.IO.File]::WriteAllText($target, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ".env gerado em $target. Nunca faca commit deste arquivo."
