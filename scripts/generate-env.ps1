# Gera o arquivo de configuração no Windows (PowerShell 5.1+), preenchendo cada segredo com
# bytes aleatórios criptograficamente seguros.
#
#   Docker Desktop (este PC):   powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1 [-Force]
#   OpenMediaVault (NAS):       powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1 -Omv [-Force]
#
# Com -Omv o script pergunta o endereço do NAS, a pasta e o e-mail do administrador, e grava
# deploy\omv\orbit.env — o conteúdo vai na caixa "Environment" da stack no OMV.
param([switch]$Force, [switch]$Omv)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if ($Omv) {
  $template = Join-Path $root 'deploy/omv/orbit.env.example'
  $target = Join-Path $root 'deploy/omv/orbit.env'
} else {
  $template = Join-Path $root '.env.example'
  $target = Join-Path $root '.env'
}

if ((Test-Path $target) -and -not $Force) {
  Write-Error "Ja existe $target. Use -Force para sobrescrever (um banco ja criado continua usando as senhas antigas!)."
}

$answers = @{}
if ($Omv) {
  Write-Host ''
  Write-Host 'Configuracao para o OpenMediaVault. Responda e tecle Enter.' -ForegroundColor Cyan
  Write-Host ''
  $hostAddr = (Read-Host 'IP (ou nome) do NAS na rede, ex.: 192.168.1.50').Trim()
  if (-not $hostAddr) { Write-Error 'Informe o IP do NAS.' }
  $port = (Read-Host 'Porta do site [3010]').Trim()
  if (-not $port) { $port = '3010' }
  Write-Host ''
  Write-Host 'Caminho ABSOLUTO da pasta compartilhada "orbit" no NAS.' -ForegroundColor Cyan
  Write-Host 'No OMV: Armazenamento > Pastas compartilhadas > coluna "Caminho absoluto".'
  $base = (Read-Host 'ex.: /srv/dev-disk-by-uuid-1234abcd/orbit').Trim().TrimEnd('/')
  if (-not $base.StartsWith('/')) { Write-Error 'O caminho precisa comecar com "/" (caminho do Linux do NAS, nao do Windows).' }
  Write-Host ''
  $email = (Read-Host 'Seu e-mail (sera o administrador)').Trim()
  if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Write-Error 'E-mail invalido.' }
  $name = (Read-Host 'Seu nome (como quer ser chamado)').Trim()

  $answers['ORBIT_APP_DIR'] = "$base/app"
  $answers['ORBIT_DATA_DIR'] = "$base/dados"
  $answers['WEB_PORT'] = $port
  $answers['WEB_ORIGIN'] = "http://${hostAddr}:$port"
  $answers['BOOTSTRAP_ADMIN_EMAIL'] = $email
  $answers['BOOTSTRAP_ADMIN_NAME'] = $name
}

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-RandomBytes([int]$count) {
  $bytes = New-Object byte[] $count
  $rng.GetBytes($bytes)
  return $bytes
}
# 36 bytes -> 48 caracteres base64url, sem padding (seguro para URL, shell e Redis).
function New-Token { ([Convert]::ToBase64String((New-RandomBytes 36))).Replace('+', '-').Replace('/', '_').TrimEnd('=') }
function New-Key32 { [Convert]::ToBase64String((New-RandomBytes 32)) }

$lines = foreach ($line in [System.IO.File]::ReadAllLines($template)) {
  if ($line -match '^([A-Z0-9_]+)=<gerado-base64-32>$') { "$($Matches[1])=$(New-Key32)" }
  elseif ($line -match '^([A-Z0-9_]+)=<gerado>$') { "$($Matches[1])=$(New-Token)" }
  elseif ($line -match '^([A-Z0-9_]+)=' -and $answers.ContainsKey($Matches[1])) { "$($Matches[1])=$($answers[$Matches[1]])" }
  else { $line }
}

# UTF-8 sem BOM e quebras LF, como o docker compose espera.
[System.IO.File]::WriteAllText($target, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ''
Write-Host "Arquivo gerado: $target" -ForegroundColor Green
if ($Omv) {
  Write-Host 'Abra com o Bloco de Notas e copie TODO o conteudo para a caixa "Environment" da stack.'
  Write-Host "Depois, abra o site em http://${hostAddr}:$port"
}
Write-Host 'Nunca envie este arquivo para o GitHub: ele contem as senhas do sistema.'
