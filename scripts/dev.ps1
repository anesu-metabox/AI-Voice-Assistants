param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot ".runtime"
$backendPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$agentPython = Join-Path $projectRoot "agent\.venv\Scripts\python.exe"
$frontendDir = Join-Path $projectRoot "frontend"
$agentDir = Join-Path $projectRoot "agent"
$nextCli = Join-Path $frontendDir "node_modules\next\dist\bin\next"

function Assert-PathExists([string]$path, [string]$label) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "$label was not found at '$path'. Install the project dependencies first."
    }
}

function Assert-PortAvailable([int]$port, [string]$service) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($listener) {
        throw "$service cannot start because port $port is already in use."
    }
}

function Wait-ForEndpoint(
    [string]$name,
    [string]$url,
    [System.Diagnostics.Process]$process,
    [string]$errorLog,
    [int]$timeoutSeconds = 60
) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited) {
            $details = if (Test-Path -LiteralPath $errorLog) {
                (Get-Content -LiteralPath $errorLog -Raw).Trim()
            }
            else {
                "No error log was produced."
            }
            throw "$name exited before becoming ready (code $($process.ExitCode)). $details"
        }
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "  $name ready at $url"
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    throw "$name did not become ready at $url within $timeoutSeconds seconds."
}

function Wait-ForLogPattern(
    [string]$name,
    [string]$logPath,
    [string]$pattern,
    [System.Diagnostics.Process]$process,
    [int]$timeoutSeconds = 60
) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited) {
            throw "$name exited before registration completed (code $($process.ExitCode))."
        }
        if ((Test-Path -LiteralPath $logPath) -and
            (Select-String -LiteralPath $logPath -Pattern $pattern -Quiet)) {
            Write-Host "  $name registered and prewarmed"
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "$name did not register within $timeoutSeconds seconds. Check $logPath."
}

Assert-PathExists $backendPython "Backend Python environment"
Assert-PathExists $agentPython "Agent Python environment"
Assert-PathExists $frontendDir "Frontend directory"
Assert-PathExists $nextCli "Next.js CLI"
Assert-PortAvailable 3000 "Frontend"
Assert-PortAvailable 8000 "Backend"
Assert-PortAvailable 8081 "Voice agent worker"

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$processes = @()
$backendErrorLog = Join-Path $runtimeDir "backend.err.log"
$agentErrorLog = Join-Path $runtimeDir "agent.err.log"
$agentOutputLog = Join-Path $runtimeDir "agent.out.log"
$frontendErrorLog = Join-Path $runtimeDir "frontend.err.log"
try {
    $backend = Start-Process -FilePath $backendPython `
        -ArgumentList "-m", "uvicorn", "backend.app.main:app", "--port", "8000" `
        -WorkingDirectory $projectRoot `
        -RedirectStandardOutput (Join-Path $runtimeDir "backend.out.log") `
        -RedirectStandardError $backendErrorLog `
        -PassThru -WindowStyle Hidden
    $processes += $backend

    $agent = Start-Process -FilePath $agentPython `
        -ArgumentList "agent.py", "dev" `
        -WorkingDirectory $agentDir `
        -RedirectStandardOutput $agentOutputLog `
        -RedirectStandardError $agentErrorLog `
        -PassThru -WindowStyle Hidden
    $processes += $agent

    $frontend = Start-Process -FilePath "node.exe" `
        -ArgumentList "`"$nextCli`"", "dev" `
        -WorkingDirectory $frontendDir `
        -RedirectStandardOutput (Join-Path $runtimeDir "frontend.out.log") `
        -RedirectStandardError $frontendErrorLog `
        -PassThru -WindowStyle Hidden
    $processes += $frontend

    Write-Host "Starting the complete voice stack..."
    Wait-ForEndpoint "Backend" "http://127.0.0.1:8000/health" $backend $backendErrorLog
    Wait-ForEndpoint "Voice agent worker" "http://127.0.0.1:8081/" $agent $agentErrorLog
    Wait-ForLogPattern "Voice agent worker" $agentOutputLog "registered worker" $agent
    Wait-ForEndpoint "Frontend" "http://127.0.0.1:3000/" $frontend $frontendErrorLog
    Write-Host "All services are ready. Open http://localhost:3000/"
    Write-Host "Runtime logs: $runtimeDir"
    Write-Host "Press Ctrl+C to stop all services."

    while ($true) {
        foreach ($process in $processes) {
            if ($process.HasExited) {
                throw "A service exited unexpectedly with code $($process.ExitCode). Check $runtimeDir for details."
            }
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    foreach ($process in $processes) {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
