param(
    [switch]$Detached
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot ".runtime"
$backendPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$agentPython = Join-Path $projectRoot "agent\.venv\Scripts\python.exe"
$frontendDir = Join-Path $projectRoot "frontend"
$agentDir = Join-Path $projectRoot "agent"
$nextCli = Join-Path $frontendDir "node_modules\next\dist\bin\next"
$frontendCli = $nextCli
$frontendLabel = "Next.js CLI"
$statePath = Join-Path $runtimeDir "dev-processes.json"
$servicesReady = $false

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

function Read-DotEnvValue([string]$path, [string]$key) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $line = Get-Content -LiteralPath $path | Where-Object { $_ -match "^\s*$([regex]::Escape($key))=(.*)$" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return (($line -replace "^\s*$([regex]::Escape($key))=", "").Trim().Trim('"').Trim("'"))
}

function Resolve-LocalSecret([string]$key, [string]$dotenvPath) {
    $processValue = [Environment]::GetEnvironmentVariable($key, "Process")
    if (-not [string]::IsNullOrWhiteSpace($processValue)) { return $processValue }
    return Read-DotEnvValue $dotenvPath $key
}

function Read-DotEnvKeys([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    $keys = @()
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match '^\s*([A-Z0-9_]+)=') { $keys += $Matches[1] }
    }
    return $keys
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
Assert-PathExists $frontendDir "Frontend directory"
Assert-PathExists $frontendCli $frontendLabel
$branchSignals = @()
if (-not [string]::IsNullOrWhiteSpace($env:NEON_BRANCH)) {
    $branchSignals += $env:NEON_BRANCH.Trim()
}
$dotenvBranch = Read-DotEnvValue (Join-Path $projectRoot ".env") "NEON_BRANCH"
if (-not [string]::IsNullOrWhiteSpace($dotenvBranch)) {
    $branchSignals += $dotenvBranch
}
$neonLinkPath = Join-Path $projectRoot ".neon"
if (Test-Path -LiteralPath $neonLinkPath) {
    try {
        $neonLink = Get-Content -LiteralPath $neonLinkPath -Raw | ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace($neonLink.branch)) {
            $branchSignals += ([string]$neonLink.branch).Trim()
        }
    } catch {
        throw "Cannot safely read the local .neon branch link; refusing to start the stack."
    }
}
$protectedBranch = $branchSignals | Where-Object { $_ -match '^(production|main|primary)$' } | Select-Object -First 1
if ($protectedBranch) {
    throw "Refusing to start local services: a configured Neon branch signal selects '$protectedBranch'. Change the process environment, root .env, and .neon link to the same isolated test branch and matching DATABASE_URL first."
}
$distinctBranches = @($branchSignals | Select-Object -Unique)
if ($distinctBranches.Count -gt 1) {
    throw "Refusing to start local services: Neon branch settings disagree ($($distinctBranches -join ', ')). Align NEON_BRANCH in the process, root .env, and .neon link, then verify DATABASE_URL."
}
$frontendEnvPath = Join-Path $frontendDir ".env.local"
$rootEnvPath = Join-Path $projectRoot ".env"
$frontendForbiddenKeys = @(
    "DATABASE_URL", "DATABASE_URL_UNPOOLED", "GOOGLE_API_KEY", "GOOGLE_CLIENT_SECRET",
    "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TRIGGER_API_KEY", "CREDENTIAL_BROKER_SHARED_SECRET",
    "GOOGLE_OAUTH_STATE_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_KMS_KEY_ID",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"
)
$frontendLeakKeys = @(Read-DotEnvKeys $frontendEnvPath | Where-Object { $_ -in $frontendForbiddenKeys })
if ($frontendLeakKeys.Count -gt 0) {
    throw "Refusing to start Next.js with private service credentials in frontend/.env.local: $($frontendLeakKeys -join ', '). Keep database/provider/KMS secrets in their owning server workloads."
}
Assert-PortAvailable 3000 "Frontend"
Assert-PortAvailable 8000 "Backend"
Assert-PortAvailable 8001 "Credential broker"

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$processes = @()
$brokerSecret = Resolve-LocalSecret "CREDENTIAL_BROKER_SHARED_SECRET" $rootEnvPath
if (-not $brokerSecret) {
    $brokerSecretBytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($brokerSecretBytes)
    $brokerSecret = [Convert]::ToBase64String($brokerSecretBytes)
}
if ($brokerSecret.Length -lt 32) {
    throw "CREDENTIAL_BROKER_SHARED_SECRET must contain at least 32 characters."
}
$liveKitApiKey = Resolve-LocalSecret "LIVEKIT_API_KEY" $rootEnvPath
$liveKitApiSecret = Resolve-LocalSecret "LIVEKIT_API_SECRET" $rootEnvPath
$liveKitUrl = Resolve-LocalSecret "LIVEKIT_URL" $rootEnvPath
$googleApiKey = Resolve-LocalSecret "GOOGLE_API_KEY" $rootEnvPath
if (-not $liveKitApiKey -or -not $liveKitApiSecret -or -not $liveKitUrl) {
    throw "LiveKit is not configured for the backend. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL in the root .env or process environment."
}
if (-not $googleApiKey) {
    $googleApiKey = Read-DotEnvValue (Join-Path $agentDir ".env") "GOOGLE_API_KEY"
}
if (-not $googleApiKey) {
    throw "Gemini is not configured for the voice worker. Set GOOGLE_API_KEY in the root .env or agent/.env."
}
$sessionContextSecret = Resolve-LocalSecret "LIVEKIT_SESSION_CONTEXT_SECRET" $rootEnvPath
if (-not $sessionContextSecret) {
    $sessionContextSecret = Read-DotEnvValue (Join-Path $agentDir ".env") "LIVEKIT_SESSION_CONTEXT_SECRET"
}
if (-not $sessionContextSecret) {
    $sessionContextBytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($sessionContextBytes)
    $sessionContextSecret = [Convert]::ToBase64String($sessionContextBytes)
}
$oauthStateSecret = Resolve-LocalSecret "GOOGLE_OAUTH_STATE_SECRET" $rootEnvPath
if (-not $oauthStateSecret) {
    $oauthStateBytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($oauthStateBytes)
    $oauthStateSecret = [Convert]::ToBase64String($oauthStateBytes)
}
$brokerErrorLog = Join-Path $runtimeDir "credential-broker.err.log"
$brokerOutputLog = Join-Path $runtimeDir "credential-broker.out.log"
$backendErrorLog = Join-Path $runtimeDir "backend.err.log"
$agentErrorLog = Join-Path $runtimeDir "agent.err.log"
$agentOutputLog = Join-Path $runtimeDir "agent.out.log"
$frontendErrorLog = Join-Path $runtimeDir "frontend.err.log"
function Start-ServiceProcess(
    [string]$filePath,
    [string[]]$argList,
    [string]$workDir,
    [hashtable]$envMap,
    [string]$outLog,
    [string]$errLog
) {
    $saved = @{}
    foreach ($k in $envMap.Keys) {
        $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process")
        $val = $envMap[$k]
        [Environment]::SetEnvironmentVariable($k, $val, "Process")
    }
    try {
        $proc = Start-Process -FilePath $filePath `
            -ArgumentList $argList `
            -WorkingDirectory $workDir `
            -RedirectStandardOutput $outLog `
            -RedirectStandardError $errLog `
            -PassThru -WindowStyle Hidden
        return $proc
    } finally {
        foreach ($k in $saved.Keys) {
            [Environment]::SetEnvironmentVariable($k, $saved[$k], "Process")
        }
    }
}

try {
    $broker = Start-ServiceProcess $backendPython `
        @("-m", "uvicorn", "backend.credential_broker.main:app", "--host", "127.0.0.1", "--port", "8001") `
        $projectRoot `
        @{
            CREDENTIAL_BROKER_SHARED_SECRET = $brokerSecret
            LIVEKIT_API_KEY = $null
            LIVEKIT_API_SECRET = $null
            LIVEKIT_SESSION_CONTEXT_SECRET = $null
            GOOGLE_API_KEY = $null
            GOOGLE_OAUTH_STATE_SECRET = $null
            DATABASE_URL_UNPOOLED = $null
            RUNTIME_DB_PASSWORD = $null
        } `
        $brokerOutputLog `
        $brokerErrorLog
    $processes += $broker

    $backend = Start-ServiceProcess $backendPython `
        @("-m", "uvicorn", "backend.app.main:app", "--port", "8000") `
        $projectRoot `
        @{
            CREDENTIAL_BROKER_SHARED_SECRET = $brokerSecret
            LIVEKIT_API_KEY = $liveKitApiKey
            LIVEKIT_API_SECRET = $liveKitApiSecret
            LIVEKIT_URL = $liveKitUrl
            LIVEKIT_SESSION_CONTEXT_SECRET = $sessionContextSecret
            GOOGLE_OAUTH_STATE_SECRET = $oauthStateSecret
            DATABASE_URL_UNPOOLED = $null
            RUNTIME_DB_PASSWORD = $null
            GOOGLE_CLIENT_SECRET = $null
            GOOGLE_API_KEY = $null
            CREDENTIAL_ENCRYPTION_KEY = $null
            CREDENTIAL_KMS_KEY_ID = $null
            AWS_ACCESS_KEY_ID = $null
            AWS_SECRET_ACCESS_KEY = $null
        } `
        (Join-Path $runtimeDir "backend.out.log") `
        $backendErrorLog
    $processes += $backend

    $hasAgent = (Test-Path -LiteralPath $agentPython)
    if ($hasAgent) {
        $agent = Start-ServiceProcess $agentPython `
            @("agent.py", "start") `
            $agentDir `
            @{
                CREDENTIAL_BROKER_SHARED_SECRET = $null
                DATABASE_URL = $null
                DATABASE_URL_UNPOOLED = $null
                RUNTIME_DB_PASSWORD = $null
                GOOGLE_CLIENT_SECRET = $null
                GOOGLE_OAUTH_STATE_SECRET = $null
                CREDENTIAL_ENCRYPTION_KEY = $null
                CREDENTIAL_KMS_KEY_ID = $null
                AWS_ACCESS_KEY_ID = $null
                AWS_SECRET_ACCESS_KEY = $null
                LIVEKIT_API_KEY = $liveKitApiKey
                LIVEKIT_API_SECRET = $liveKitApiSecret
                LIVEKIT_URL = $liveKitUrl
                GOOGLE_API_KEY = $googleApiKey
                LIVEKIT_SESSION_CONTEXT_SECRET = $sessionContextSecret
            } `
            $agentOutputLog `
            $agentErrorLog
        $processes += $agent
    }

    $frontendArgs = @("`"$nextCli`"", "dev")
    $frontend = Start-ServiceProcess "node.exe" `
        $frontendArgs `
        $frontendDir `
        @{
            CREDENTIAL_BROKER_SHARED_SECRET = $null
            TRIGGER_API_KEY = $null
            LIVEKIT_URL = $null
            LIVEKIT_API_KEY = $null
            LIVEKIT_API_SECRET = $null
            LIVEKIT_SESSION_CONTEXT_SECRET = $sessionContextSecret
            GOOGLE_OAUTH_STATE_SECRET = $null
            GOOGLE_API_KEY = $null
            GOOGLE_CLIENT_SECRET = $null
            CREDENTIAL_ENCRYPTION_KEY = $null
            CREDENTIAL_KMS_KEY_ID = $null
            AWS_ACCESS_KEY_ID = $null
            AWS_SECRET_ACCESS_KEY = $null
            DATABASE_URL = $null
            DATABASE_URL_UNPOOLED = $null
        } `
        (Join-Path $runtimeDir "frontend.out.log") `
        $frontendErrorLog
    $processes += $frontend

    Write-Host "Starting the complete voice stack..."
    Wait-ForEndpoint "Credential broker" "http://127.0.0.1:8001/health" $broker $brokerErrorLog
    Wait-ForEndpoint "Backend" "http://127.0.0.1:8000/health" $backend $backendErrorLog
    if ($hasAgent) {
        try {
            Wait-ForEndpoint "Voice agent worker" "http://127.0.0.1:8081/" $agent $agentErrorLog 15
            Wait-ForLogPattern "Voice agent worker" $agentOutputLog "registered worker" $agent 15
        } catch {
            Write-Host "  Note: Voice agent worker running in background or standalone mode ($($_.Exception.Message))"
        }
    }
    Wait-ForEndpoint "Frontend" "http://127.0.0.1:3000/" $frontend $frontendErrorLog
    Write-Host "All services are ready. Open http://localhost:3000/"
    Write-Host "Runtime logs: $runtimeDir"

    $state = @{
        started_at = (Get-Date).ToUniversalTime().ToString("o")
        processes = @($processes | Where-Object { $_ -ne $null } | ForEach-Object {
            $_.Refresh()
            @{
                id = $_.Id
                name = $_.ProcessName
                started_at_ticks = $_.StartTime.ToUniversalTime().Ticks
            }
        })
    }
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
    $servicesReady = $true

    if ($Detached) {
        Write-Host "Services will remain running after this command exits."
        Write-Host "Run scripts/stop-dev.ps1 to stop this stack."
        return
    }

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
    if (-not $Detached -or -not $servicesReady) {
        foreach ($process in $processes) {
            if (-not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
}
