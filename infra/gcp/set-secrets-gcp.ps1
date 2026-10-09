<#
.SYNOPSIS
    Script to create and populate secrets in Google Cloud Secret Manager.
.DESCRIPTION
    Dynamically loads values from environment variables or .env file and sets them in Secret Manager:
      - DATABASE_URL
      - BOOKING_WORKER_DATABASE_URL
      - CREDENTIAL_BROKER_SHARED_SECRET
      - LIVEKIT_SESSION_CONTEXT_SECRET
      - GOOGLE_OAUTH_STATE_SECRET
      - GOOGLE_CLIENT_SECRET
      - CREDENTIAL_ENCRYPTION_KEY
      - LIVEKIT_API_SECRET
      - GOOGLE_API_KEY
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$ProjectId = "project-b41c2c97-b828-4d42-a59",

    [Parameter(Mandatory = $false)]
    [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

function Check-GcloudCli {
    if (-not (Get-Command "gcloud" -ErrorAction SilentlyContinue)) {
        Write-Error "gcloud CLI is not installed or not in PATH."
    }
}

Check-GcloudCli

# Load .env if present
$EnvValues = @{}
if (Test-Path $EnvFile) {
    Write-Host "Loading secret values from $EnvFile..." -ForegroundColor Cyan
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $EnvValues[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
        }
    }
}

function Get-SecretValue([string]$key) {
    if ($EnvValues.ContainsKey($key) -and $EnvValues[$key]) {
        return $EnvValues[$key]
    }
    $envVal = [System.Environment]::GetEnvironmentVariable($key)
    if ($envVal) {
        return $envVal
    }
    return $null
}

Write-Host "==> Configuring Google Cloud Secret Manager in project '$ProjectId'..." -ForegroundColor Cyan

$SecretsMap = @{
    "voice-database-url"          = "DATABASE_URL"
    "voice-booking-database-url"  = "BOOKING_WORKER_DATABASE_URL"
    "voice-broker-secret"         = "CREDENTIAL_BROKER_SHARED_SECRET"
    "voice-context-secret"        = "LIVEKIT_SESSION_CONTEXT_SECRET"
    "voice-oauth-state-secret"    = "GOOGLE_OAUTH_STATE_SECRET"
    "voice-google-client-secret"  = "GOOGLE_CLIENT_SECRET"
    "voice-encryption-key"        = "CREDENTIAL_ENCRYPTION_KEY"
    "voice-livekit-api-secret"    = "LIVEKIT_API_SECRET"
    "voice-google-api-key"        = "GOOGLE_API_KEY"
}

foreach ($entry in $SecretsMap.GetEnumerator()) {
    $secretName = $entry.Key
    $envVarName = $entry.Value
    $val = Get-SecretValue $envVarName

    if (-not $val) {
        Write-Host "Warning: No value found for $envVarName ($secretName). Skipping." -ForegroundColor Yellow
        continue
    }

    $check = gcloud secrets describe $secretName --project=$ProjectId 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Creating secret: $secretName" -ForegroundColor Green
        $val | gcloud secrets create $secretName --project=$ProjectId --replication-policy="automatic" --data-file=-
    } else {
        Write-Host "Updating secret version: $secretName" -ForegroundColor Green
        $val | gcloud secrets versions add $secretName --project=$ProjectId --data-file=-
    }
}

$ProjectNumber = (gcloud projects describe $ProjectId --format='value(projectNumber)').Trim()
$ComputeSa = "$ProjectNumber-compute@developer.gserviceaccount.com"

Write-Host "==> Authorizing Cloud Run Service Account: $ComputeSa" -ForegroundColor Cyan
gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$ComputeSa" `
    --role="roles/secretmanager.secretAccessor" | Out-Null

Write-Host "`nAll Google Cloud Secret Manager entries configured!" -ForegroundColor Green
