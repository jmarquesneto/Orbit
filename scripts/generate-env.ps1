# Gera o .env a partir do .env.example no Windows (PowerShell 5.1+), preenchendo cada
# segredo com bytes aleatórios criptograficamente seguros.
# Uso:  powershell -ExecutionPolicy Bypass -File .\scripts\generate-env.ps1 [-Force]
param([switch]$Force)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$template = Join-Path $root '.env.example'
$target = Join-Path $root '.env'

if ((Test-Path $target) -and -not $Force) {
  Write-Error 'Ja existe um .env. Use -Force para sobrescrever (os dados do banco usam as senhas antigas!).'
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
  else { $line }
}

# UTF-8 sem BOM e quebras LF, como o docker compose espera.
[System.IO.File]::WriteAllText($target, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ".env gerado em $target. Nunca faca commit deste arquivo."
