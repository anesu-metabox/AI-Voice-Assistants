param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot ".runtime\dev-processes.json"
$stoppedIds = [System.Collections.Generic.HashSet[int]]::new()

if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    foreach ($record in @($state.processes)) {
        $process = Get-Process -Id ([int]$record.id) -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime.ToUniversalTime().Ticks -eq [long]$record.started_at_ticks) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            $null = $stoppedIds.Add($process.Id)
        }
    }
}

# Next.js may spawn its listener as a child process. Stop only listeners on the
# three ports reserved by this project's local stack.
foreach ($port in @(3000, 8000, 8081)) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($listener in @($listeners)) {
        $processId = [int]$listener.OwningProcess
        if ($processId -gt 0 -and -not $stoppedIds.Contains($processId)) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            $null = $stoppedIds.Add($processId)
        }
    }
}

Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
Write-Host "Stopped $($stoppedIds.Count) local voice-stack process(es)."
