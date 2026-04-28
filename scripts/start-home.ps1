param(
  [int]$Port = 3100
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -First 1 -ExpandProperty IPAddress)

if (-not $ip) { $ip = "localhost" }

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Host "Port $Port is already in use. Stop that process or run: npm run home -- -Port <another-port>"
  exit 1
}

Write-Host "Family Fantasy Football"
Write-Host "Local URL: http://localhost:$Port"
Write-Host "Family LAN URL: http://$ip`:$Port"
Write-Host "Health and admin status are available after commissioner sign-in."

$env:HOST = "0.0.0.0"
$env:PORT = "$Port"
Set-Location $repo
npm start
