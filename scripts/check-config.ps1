param(
    [switch]$IncludeExternalAuth,
    [switch]$Production,
    [switch]$CredentialBroker
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Read-DotEnvKeys([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return @{} }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim().Trim('"') }
    }
    return $values
}

function Read-DotEnvKeyNames([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    $keys = @()
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match '^\s*([A-Z0-9_]+)=') { $keys += $Matches[1] }
    }
    return $keys
}

function Get-PostgresUrlUsername([string]$connectionString) {
    try {
        $uri = [System.Uri]$connectionString
        if (-not $uri.IsAbsoluteUri -or [string]::IsNullOrWhiteSpace($uri.UserInfo)) { return $null }
        $encodedUsername = $uri.UserInfo.Split(':', 2)[0]
        return [System.Uri]::UnescapeDataString($encodedUsername)
    } catch {
        return $null
    }
}

$rootEnv = Read-DotEnvKeys (Join-Path $projectRoot ".env")
$frontendEnv = Read-DotEnvKeys (Join-Path $projectRoot "frontend\.env.local")
$agentEnv = Read-DotEnvKeys (Join-Path $projectRoot "agent\.env")
$brokerEnv = Read-DotEnvKeys (Join-Path $projectRoot "backend\credential_broker\.env")
$frontendKeys = Read-DotEnvKeyNames (Join-Path $projectRoot "frontend\.env.local")
$agentKeys = Read-DotEnvKeyNames (Join-Path $projectRoot "agent\.env")

# Deployment platforms commonly inject secrets into the process environment
# rather than writing them to a file. Use that source only as a fallback and
# never print the values.
$knownKeys = @(
    "DATABASE_URL", "DATABASE_URL_UNPOOLED", "LIVEKIT_URL", "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET", "GOOGLE_API_KEY", "GOOGLE_CLIENT_SECRET", "LIVEKIT_SESSION_CONTEXT_SECRET",
    "GOOGLE_OAUTH_STATE_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_KEY_PROVIDER",
    "CREDENTIAL_ENCRYPTION_KEY_VERSION", "CREDENTIAL_ENCRYPTION_PREVIOUS_KEY",
    "CREDENTIAL_ENCRYPTION_PREVIOUS_KEY_VERSION", "CREDENTIAL_KMS_KEY_ID",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "RUNTIME_DB_ROLE", "RUNTIME_DB_PASSWORD", "APP_ENV", "NEON_AUTH_URL", "NEON_AUTH_BASE_URL",
    "CREDENTIAL_BROKER_URL", "CREDENTIAL_BROKER_SHARED_SECRET"
)
foreach ($key in $knownKeys) {
    $injected = [Environment]::GetEnvironmentVariable($key)
    if ([string]::IsNullOrWhiteSpace($rootEnv[$key]) -and -not [string]::IsNullOrWhiteSpace($injected)) {
        $rootEnv[$key] = $injected
    }
    if ($CredentialBroker -and [string]::IsNullOrWhiteSpace($brokerEnv[$key]) -and -not [string]::IsNullOrWhiteSpace($injected)) {
        $brokerEnv[$key] = $injected
    }
}

$requiredRoot = @(
    "DATABASE_URL", "LIVEKIT_URL", "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET", "GOOGLE_API_KEY", "LIVEKIT_SESSION_CONTEXT_SECRET",
    "GOOGLE_OAUTH_STATE_SECRET"
)
$missing = @()
$isProduction = $Production -or $rootEnv["APP_ENV"] -in @("prod", "production")
if ($isProduction) {
    if ($CredentialBroker) {
        # Broker-only keys must come from its own service environment (or its
        # dedicated local env file), never the general API's root environment.
        $requiredRoot = @("DATABASE_URL", "APP_ENV", "RUNTIME_DB_ROLE", "CREDENTIAL_BROKER_SHARED_SECRET")
        $requiredBroker = @("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CREDENTIAL_ENCRYPTION_KEY")
    } else {
        $requiredRoot += @("APP_ENV", "RUNTIME_DB_ROLE", "CREDENTIAL_BROKER_SHARED_SECRET", "CREDENTIAL_BROKER_URL")
        $IncludeExternalAuth = $true
        if (-not [string]::IsNullOrWhiteSpace($rootEnv["CREDENTIAL_KMS_KEY_ID"])) { $missing += "remove CREDENTIAL_KMS_KEY_ID from general API configuration" }
        if (-not [string]::IsNullOrWhiteSpace($rootEnv["CREDENTIAL_KEY_PROVIDER"])) { $missing += "remove CREDENTIAL_KEY_PROVIDER from general API configuration" }
        if (-not [string]::IsNullOrWhiteSpace($rootEnv["GOOGLE_CLIENT_SECRET"])) { $missing += "remove GOOGLE_CLIENT_SECRET from general API configuration" }
    }
    $runtimeUsername = Get-PostgresUrlUsername $rootEnv["DATABASE_URL"]
    if ([string]::IsNullOrWhiteSpace($runtimeUsername)) {
        $missing += "DATABASE_URL must be a valid PostgreSQL URL with a runtime-role username"
    } elseif ($runtimeUsername -cne $rootEnv["RUNTIME_DB_ROLE"]) {
        $missing += "DATABASE_URL username must match RUNTIME_DB_ROLE (use the non-bypass-RLS runtime role)"
    }
    if (-not [string]::IsNullOrWhiteSpace($rootEnv["DATABASE_URL_UNPOOLED"])) {
        $missing += "remove DATABASE_URL_UNPOOLED from production service configuration; provide it only to the migration job"
    }
    if (-not [string]::IsNullOrWhiteSpace($rootEnv["RUNTIME_DB_PASSWORD"])) {
        $missing += "remove RUNTIME_DB_PASSWORD from production service configuration; provide it only to the role-provisioning job"
    }
    if ($CredentialBroker) {
        $missing += @($requiredBroker | Where-Object { [string]::IsNullOrWhiteSpace($brokerEnv[$_]) })
        if (-not [string]::IsNullOrWhiteSpace($brokerEnv["CREDENTIAL_KMS_KEY_ID"]) -or -not [string]::IsNullOrWhiteSpace($brokerEnv["AWS_ACCESS_KEY_ID"]) -or -not [string]::IsNullOrWhiteSpace($brokerEnv["AWS_SECRET_ACCESS_KEY"])) {
            $missing += "remove AWS KMS configuration from the credential broker; deployment is Railway-only"
        }
    }
}
$missing += @($requiredRoot | Where-Object { [string]::IsNullOrWhiteSpace($rootEnv[$_]) })
$agentMissing = @("LIVEKIT_SESSION_CONTEXT_SECRET" | Where-Object { [string]::IsNullOrWhiteSpace($agentEnv[$_]) -and [string]::IsNullOrWhiteSpace($rootEnv[$_]) })
$frontendMissing = @("LIVEKIT_SESSION_CONTEXT_SECRET" | Where-Object { [string]::IsNullOrWhiteSpace($frontendEnv[$_]) })

if ($IncludeExternalAuth -and [string]::IsNullOrWhiteSpace($frontendEnv["NEON_AUTH_URL"]) -and [string]::IsNullOrWhiteSpace($frontendEnv["NEON_AUTH_BASE_URL"])) {
    $missing += "NEON_AUTH_URL (frontend/.env.local)"
}
if ($agentMissing.Count -gt 0) { $missing += "LIVEKIT_SESSION_CONTEXT_SECRET (agent/.env)" }
if ($frontendMissing.Count -gt 0) { $missing += "LIVEKIT_SESSION_CONTEXT_SECRET (frontend/.env.local)" }

if ($isProduction -and -not $CredentialBroker -and -not [string]::IsNullOrWhiteSpace($rootEnv["CREDENTIAL_ENCRYPTION_KEY"])) {
    $missing += "remove CREDENTIAL_ENCRYPTION_KEY from general API production configuration"
}
if ($isProduction) {
    $frontendForbidden = @(
        "DATABASE_URL", "DATABASE_URL_UNPOOLED", "GOOGLE_API_KEY", "GOOGLE_CLIENT_SECRET",
        "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TRIGGER_API_KEY", "CREDENTIAL_BROKER_SHARED_SECRET",
        "GOOGLE_OAUTH_STATE_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_KMS_KEY_ID",
        "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"
    )
    foreach ($key in $frontendForbidden) {
        if ($frontendKeys -contains $key) {
            $missing += "remove $key from frontend/.env.local; frontend must not receive private service credentials"
        }
    }
    $agentForbidden = @(
        "DATABASE_URL", "DATABASE_URL_UNPOOLED", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET",
        "CREDENTIAL_BROKER_SHARED_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_PREVIOUS_KEY", "CREDENTIAL_KMS_KEY_ID",
        "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "RUNTIME_DB_PASSWORD"
    )
    foreach ($key in $agentForbidden) {
        if ($agentKeys -contains $key) {
            $missing += "remove $key from agent/.env; LiveKit worker must not receive database or integration credentials"
        }
    }
}
$missing = @($missing | Select-Object -Unique)
if ($missing.Count -gt 0) {
    Write-Error ("Missing required configuration keys: " + ($missing -join ", "))
    exit 1
}

Write-Output "Configuration preflight passed. Secret values were not printed."
