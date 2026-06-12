# cursor-bridge stop script (Windows)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $ScriptDir "cursor-bridge.pid"

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match "cursor-bridge\.mjs" }

if (-not $procs) {
    Write-Host "cursor-bridge is not running"
    Remove-Item -Path $PidFile -ErrorAction SilentlyContinue
    exit 0
}

$ids = ($procs | ForEach-Object { $_.ProcessId }) -join ", "
Write-Host "Stopping cursor-bridge (PID(s): $ids)..."
$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }

# Wait up to 5 seconds, then force kill survivors
for ($i = 0; $i -lt 5; $i++) {
    Start-Sleep -Seconds 1
    $remaining = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match "cursor-bridge\.mjs" }
    if (-not $remaining) { break }
}
if ($remaining) {
    Write-Host "Force killing (PID(s): $(($remaining | ForEach-Object { $_.ProcessId }) -join ', '))..."
    $remaining | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Remove-Item -Path $PidFile -ErrorAction SilentlyContinue
Write-Host "[OK] Stopped"
