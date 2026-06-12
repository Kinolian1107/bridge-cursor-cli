# cursor-bridge start script (Windows)
# Usage: .\start.ps1          (foreground)
#        .\start.ps1 daemon   (background, hidden window)
#
# .env is loaded by cursor-bridge.mjs itself, so no env plumbing is needed here.
param([string]$Mode = "")

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Read BRIDGE_PORT from .env for the health check (default 18790)
$BridgePort = 18790
$EnvFile = Join-Path $ScriptDir ".env"
if (Test-Path $EnvFile) {
    $portLine = Select-String -Path $EnvFile -Pattern '^\s*BRIDGE_PORT\s*=\s*"?(\d+)"?' | Select-Object -First 1
    if ($portLine) { $BridgePort = [int]$portLine.Matches[0].Groups[1].Value }
}
if ($env:BRIDGE_PORT) { $BridgePort = [int]$env:BRIDGE_PORT }

# Detect already-running instances (by command line, not pid file)
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match "cursor-bridge\.mjs" }
if ($existing) {
    $ids = ($existing | ForEach-Object { $_.ProcessId }) -join ", "
    Write-Host "cursor-bridge is already running (PID(s): $ids)"
    exit 0
}

if ($Mode -eq "daemon") {
    Write-Host "Starting cursor-bridge in background..."
    $proc = Start-Process node -ArgumentList "`"$(Join-Path $ScriptDir 'cursor-bridge.mjs')`"" `
        -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
    Write-Host "cursor-bridge started (PID $($proc.Id))"
    Start-Sleep -Seconds 2
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$BridgePort/health" -TimeoutSec 5
        Write-Host "[OK] Health check: $($health | ConvertTo-Json -Compress)"
    } catch {
        Write-Host "[FAIL] Health check failed. Check logs\ directory."
        exit 1
    }
} else {
    node (Join-Path $ScriptDir "cursor-bridge.mjs")
}
