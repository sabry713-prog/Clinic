# start-dev.ps1 -- bring up the full clinical-copilot dev stack on Windows.
#
# Idempotent: containers and services already running are left alone.
# Starts: Docker Desktop (if needed), the compose infrastructure, then the
# four app services in their own minimized PowerShell windows so logs stay
# visible and each can be stopped by closing its window.
#
# NOTE: keep this file ASCII-only. powershell.exe reads BOM-less scripts as
# ANSI, and non-ASCII bytes can mangle into quote characters and break parsing.
#
# Usage:  powershell -ExecutionPolicy Bypass -File infra\scripts\start-dev.ps1
#         add -NoBrowser to skip opening the web app (used by the logon task).

param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Test-Port([int]$port) {
    # Actual connect attempt against both loopback families: vite binds ::1
    # only, the python services 127.0.0.1 only. A parameterless TcpClient is
    # IPv4-only, so each address needs its own family-matched client.
    foreach ($address in @("127.0.0.1", "::1")) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient($address, $port)
            $client.Close()
            return $true
        } catch {}
    }
    $false
}

# --- 1. Docker engine --------------------------------------------------------
Write-Host "[1/4] Docker engine..." -ForegroundColor Cyan
$engineUp = $false
try { docker info --format "{{.ServerVersion}}" *> $null; if ($LASTEXITCODE -eq 0) { $engineUp = $true } } catch {}
if (-not $engineUp) {
    Write-Host "  starting Docker Desktop (this can take a minute)..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    foreach ($i in 1..60) {
        Start-Sleep -Seconds 5
        try { docker info --format "x" *> $null; if ($LASTEXITCODE -eq 0) { $engineUp = $true; break } } catch {}
    }
    if (-not $engineUp) { throw "Docker engine did not come up within 5 minutes." }
}
Write-Host "  engine ready." -ForegroundColor Green

# --- 2. Infrastructure containers --------------------------------------------
Write-Host "[2/4] Infrastructure containers..." -ForegroundColor Cyan
docker compose -f (Join-Path $repo "docker-compose.dev.yml") up -d
Write-Host "  compose up issued." -ForegroundColor Green

# --- 3. App services ----------------------------------------------------------
# Each runs in its own minimized window with the repo .env loaded.
Write-Host "[3/4] App services..." -ForegroundColor Cyan

$envLoader = "Get-Content '$repo\.env' | Where-Object { `$_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$' } | ForEach-Object { Set-Item -Path (`"env:`" + `$Matches[1]) -Value `$Matches[2] }"

$services = @(
    @{ Name = "core-4000";      Port = 4000; Dir = $repo;                              Cmd = "pnpm --filter '@app/core' run dev" },
    @{ Name = "web-3000";       Port = 3000; Dir = $repo;                              Cmd = "pnpm --filter '@app/web' run dev" },
    @{ Name = "narrative-5001"; Port = 5001; Dir = (Join-Path $repo "apps\narrative"); Cmd = "uv run uvicorn main:app --port 5001" },
    @{ Name = "qa-5002";        Port = 5002; Dir = (Join-Path $repo "apps\qa");        Cmd = "uv run uvicorn main:app --port 5002" },
    @{ Name = "transcription-5003"; Port = 5003; Dir = (Join-Path $repo "apps\transcription"); Cmd = "uv run uvicorn main:app --port 5003" }
)

foreach ($svc in $services) {
    if (Test-Port $svc.Port) {
        Write-Host ("  {0} already running -- skipped." -f $svc.Name)
        continue
    }
    $inner = "`$Host.UI.RawUI.WindowTitle = 'clinic {0}'; Set-Location '{1}'; {2}; {3}" -f $svc.Name, $svc.Dir, $envLoader, $svc.Cmd
    Start-Process powershell -WindowStyle Minimized -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $inner
    Write-Host ("  {0} starting (minimized window)." -f $svc.Name)
}

# --- 4. Health check ----------------------------------------------------------
Write-Host "[4/4] Waiting for services..." -ForegroundColor Cyan
$checks = [ordered]@{
    "web :3000"       = "http://localhost:3000"
    "core API :4000"  = "http://127.0.0.1:4000/api/v1/health"
    "narrative :5001" = "http://127.0.0.1:5001/health"
    "qa :5002"        = "http://127.0.0.1:5002/health"
    "transcription :5003" = "http://127.0.0.1:5003/health"
}
$results = @{}
foreach ($i in 1..30) {
    foreach ($k in @($checks.Keys)) {
        if (-not $results[$k]) {
            try {
                $null = Invoke-WebRequest -Uri $checks[$k] -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
                $results[$k] = $true
            } catch {}
        }
    }
    if ($results.Count -eq $checks.Count) { break }
    Start-Sleep -Seconds 4
}

$allUp = $true
foreach ($k in $checks.Keys) {
    if ($results[$k]) {
        Write-Host "  $k : OK" -ForegroundColor Green
    } else {
        Write-Host "  $k : NOT RESPONDING" -ForegroundColor Yellow
        $allUp = $false
    }
}

if ($allUp) {
    Write-Host ""
    if ($NoBrowser) {
        Write-Host "All services up at http://localhost:3000" -ForegroundColor Green
    } else {
        Write-Host "All services up -- opening http://localhost:3000" -ForegroundColor Green
        Start-Process "http://localhost:3000"
    }
} else {
    Write-Host ""
    Write-Host "Some services did not come up; check their minimized windows for errors." -ForegroundColor Yellow
}
