# cursor-bridge installer (Windows)
# Usage: .\install.ps1
#
# Mirrors install.sh for Windows:
#   1. Checks Node.js >= 22
#   2. Detects the cursor-agent / cursor CLI binary
#   3. Creates .env pointing CURSOR_BIN at the detected binary
#
# Start/stop scripts (start.ps1 / stop.ps1) ship with the repo.
# OpenClaw integration and shell auto-start are Linux/macOS-only (install.sh).

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Defaults (override via environment before running)
$BridgePort = if ($env:BRIDGE_PORT) { $env:BRIDGE_PORT } else { "18790" }
$CursorModel = if ($env:CURSOR_MODEL) { $env:CURSOR_MODEL } else { "auto" }
$CursorWorkspace = if ($env:CURSOR_WORKSPACE) { $env:CURSOR_WORKSPACE } else { Join-Path $env:USERPROFILE ".cursor-bridge\workspace" }

Write-Host ""
Write-Host "+--------------------------------------------------+"
Write-Host "|  cursor-bridge installer (Windows)               |"
Write-Host "|  OpenAI/Anthropic-compatible proxy for Cursor CLI|"
Write-Host "+--------------------------------------------------+"
Write-Host ""

# -- 1. Check prerequisites ------------------------------------
Write-Host "Checking prerequisites..."

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[FAIL] Node.js not found. Install Node >= 22 first: https://nodejs.org"
    exit 1
}
$nodeMajor = [int]((node -v) -replace '^v', '' -split '\.')[0]
if ($nodeMajor -lt 22) {
    Write-Host "[FAIL] Node.js >= 22 required (found $(node -v))"
    exit 1
}
Write-Host "[OK] Node.js $(node -v)"

# Cursor CLI — PATH first, then the default native-install location.
# Native install: irm 'https://cursor.com/install?win32=true' | iex
$CursorBin = $null
foreach ($name in @("cursor-agent", "cursor")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { $CursorBin = $cmd.Source; break }
}
if (-not $CursorBin) {
    foreach ($candidate in @(
        (Join-Path $env:USERPROFILE ".local\bin\cursor-agent.exe"),
        (Join-Path $env:USERPROFILE ".local\bin\cursor-agent.cmd")
    )) {
        if (Test-Path $candidate) { $CursorBin = $candidate; break }
    }
}
if (-not $CursorBin) {
    Write-Host "[FAIL] Cursor CLI not found. Install it first:"
    Write-Host "       irm 'https://cursor.com/install?win32=true' | iex"
    exit 1
}
Write-Host "[OK] Cursor CLI: $CursorBin"

# -- 2. List available Cursor models (best-effort) -------------
Write-Host ""
Write-Host "Available Cursor models (first 20):"
try {
    if ($CursorBin -match "cursor-agent") {
        & $CursorBin --list-models 2>$null | Select-Object -First 20
    } else {
        & $CursorBin agent --list-models 2>$null | Select-Object -First 20
    }
} catch {
    Write-Host "  (model probe failed - the bridge will probe at runtime)"
}
Write-Host ""
Write-Host "Selected model: $CursorModel"
Write-Host "  (Override with: `$env:CURSOR_MODEL='<model-id>'; .\install.ps1)"
Write-Host ""

# -- 3. Create .env --------------------------------------------
$EnvFile = Join-Path $ScriptDir ".env"
@"
# cursor-bridge configuration
BRIDGE_PORT=$BridgePort
CURSOR_MODEL=$CursorModel
CURSOR_BIN=$CursorBin
CURSOR_WORKSPACE=$CursorWorkspace
# CURSOR_MODE=ask  # Uncomment for read-only Q&A mode
"@ | Set-Content -Path $EnvFile -Encoding UTF8
Write-Host "[OK] Created $EnvFile"

# -- Done -------------------------------------------------------
Write-Host ""
Write-Host "+----------------------------------------------------------+"
Write-Host "|  Installation complete!                                  |"
Write-Host "+----------------------------------------------------------+"
Write-Host ""
Write-Host "  Start bridge:  .\start.ps1 daemon"
Write-Host "  Stop bridge:   .\stop.ps1"
Write-Host "  Follow log:    Get-Content `"logs\cursor-bridge.`$(Get-Date -Format yyyyMMdd).log`" -Wait"
Write-Host ""
Write-Host "  Test:          curl http://127.0.0.1:$BridgePort/health"
Write-Host ""
Write-Host "  Optional: trim the model list with  node select-models.mjs"
Write-Host ""
