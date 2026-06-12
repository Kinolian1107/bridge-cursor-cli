# cursor-bridge stop script (Windows)
# Running instances are found by command line — no pid file involved.

function Get-BridgeProcs {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match "cursor-bridge\.mjs" }
}

$procs = Get-BridgeProcs
if (-not $procs) {
    Write-Host "cursor-bridge is not running"
    exit 0
}

$ids = ($procs | ForEach-Object { $_.ProcessId }) -join ", "
Write-Host "Stopping cursor-bridge (PID(s): $ids)..."
$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }

# Wait up to 5 seconds, then force kill survivors
for ($i = 0; $i -lt 5; $i++) {
    Start-Sleep -Seconds 1
    $remaining = Get-BridgeProcs
    if (-not $remaining) { break }
}
if ($remaining) {
    Write-Host "Force killing (PID(s): $(($remaining | ForEach-Object { $_.ProcessId }) -join ', '))..."
    $remaining | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Write-Host "[OK] Stopped"
