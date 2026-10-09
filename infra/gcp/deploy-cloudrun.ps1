<#
.SYNOPSIS
    Deploy AI Voice Bot Backend to Google Cloud Run.
.DESCRIPTION
    Builds the Docker container with Google Cloud Build and deploys 4 services:
      1. Voice Credential Broker (Internal / Authenticated)
      2. General Voice API (Public HTTPS)
      3. Calendar Booking Worker (Background Daemon with CPU always allocated)
      4. LiveKit Voice Agent Worker (Background Daemon with CPU always allocated)
.EXAMPLE
    .\infra\gcp\deploy-cloudrun.ps1 -ProjectId "project-b41c2c97-b828-4d42-a59" -Region "us-central1"
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$ProjectId = "project-b41c2c97-b828-4d42-a59",

    [Parameter(Mandatory = $false)]
    [string]$Region = "us-central1",

    [Parameter(Mandatory = $false)]
    [string]$ServicePrefix = "voice"
)

$ErrorActionPreference = "Stop"

function Check-GcloudCli {
    if (-not (Get-Command "gcloud" -ErrorAction SilentlyContinue)) {
        Write-Error "gcloud CLI is not installed or not in PATH. Run this script in Google Cloud Shell or install Google Cloud SDK."
    }
}

Check-GcloudCli

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Deploying AI Voice Bot Backend to Google Cloud Run" -ForegroundColor Cyan
Write-Host " Project: $ProjectId"
Write-Host " Region:  $Region"
Write-Host " Prefix:  $ServicePrefix"
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Set current project
& gcloud config set project $ProjectId

# 2. Enable APIs
Write-Host "`n==> [1/5] Enabling Google Cloud Services..." -ForegroundColor Green
& gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com

# 3. Create Artifact Registry if needed
Write-Host "`n==> [2/5] Checking Artifact Registry..." -ForegroundColor Green
& gcloud artifacts repositories describe "voice-bot" --location=$Region 2>$null
if ($LASTEXITCODE -ne 0) {
    & gcloud artifacts repositories create "voice-bot" --repository-format=docker --location=$Region --description="AI Voice Bot backend images"
}

# 4. Push Secrets
Write-Host "`n==> [3/5] Syncing Secrets to Secret Manager..." -ForegroundColor Green
& "$PSScriptRoot\set-secrets-gcp.ps1" -ProjectId $ProjectId

# 5. Build image via Cloud Build (No local Docker needed!)
$ImageTag = "$Region-docker.pkg.dev/$ProjectId/voice-bot/backend:latest"
Write-Host "`n==> [4/5] Building image via Google Cloud Build ($ImageTag)..." -ForegroundColor Green
& gcloud builds submit --tag $ImageTag $RepoRoot

# 6. Deploy Services
Write-Host "`n==> [5/5] Deploying Microservices to Cloud Run..." -ForegroundColor Green

# 6a. Credential Broker
$BrokerApp = "$ServicePrefix-broker"
Write-Host "Deploying $BrokerApp..." -ForegroundColor Yellow
& gcloud run deploy $BrokerApp `
    --image=$ImageTag `
    --region=$Region `
    --platform=managed `
    --no-allow-unauthenticated `
    --ingress=all `
    --command="sh" `
    --args="-c,python -m uvicorn backend.credential_broker.main:app --host 0.0.0.0 --port `$PORT" `
    --memory=512Mi `
    --cpu=1 `
    --min-instances=0 `
    --max-instances=5 `
    --set-secrets="DATABASE_URL=voice-database-url:latest,CREDENTIAL_BROKER_SHARED_SECRET=voice-broker-secret:latest,GOOGLE_CLIENT_SECRET=voice-google-client-secret:latest,CREDENTIAL_ENCRYPTION_KEY=voice-encryption-key:latest" `
    --set-env-vars="APP_ENV=production,NEON_BRANCH=production,RUNTIME_DB_ROLE=ai_voice_bot_runtime,CREDENTIAL_KEY_PROVIDER=env,GOOGLE_CLIENT_ID=921027457755-kf4epo0unnhnhno0ug71jepv5bo52um0.apps.googleusercontent.com"

$BrokerUrl = (& gcloud run services describe $BrokerApp --region=$Region --format='value(status.url)').Trim()
Write-Host "Broker deployed at: $BrokerUrl" -ForegroundColor Green

# 6b. General Voice API
$ApiApp = "$ServicePrefix-api"
Write-Host "Deploying $ApiApp..." -ForegroundColor Yellow
& gcloud run deploy $ApiApp `
    --image=$ImageTag `
    --region=$Region `
    --platform=managed `
    --allow-unauthenticated `
    --command="sh" `
    --args="-c,python -m uvicorn backend.app.main:app --host 0.0.0.0 --port `$PORT" `
    --memory=512Mi `
    --cpu=1 `
    --min-instances=1 `
    --max-instances=10 `
    --set-secrets="DATABASE_URL=voice-database-url:latest,LIVEKIT_API_SECRET=voice-livekit-api-secret:latest,LIVEKIT_SESSION_CONTEXT_SECRET=voice-context-secret:latest,GOOGLE_OAUTH_STATE_SECRET=voice-oauth-state-secret:latest,CREDENTIAL_BROKER_SHARED_SECRET=voice-broker-secret:latest" `
    --set-env-vars="APP_ENV=production,NEON_BRANCH=production,RUNTIME_DB_ROLE=ai_voice_bot_runtime,LIVEKIT_URL=wss://ai-voice-assistant-vu6rr406.livekit.cloud,LIVEKIT_API_KEY=API6cHSaYkSN7qB,GOOGLE_CLIENT_ID=921027457755-kf4epo0unnhnhno0ug71jepv5bo52um0.apps.googleusercontent.com,CREDENTIAL_BROKER_URL=$BrokerUrl,CORS_ORIGINS=*"

$ApiUrl = (& gcloud run services describe $ApiApp --region=$Region --format='value(status.url)').Trim()
Write-Host "Voice API deployed at: $ApiUrl" -ForegroundColor Green

# 6c. Calendar Booking Worker
$BookingApp = "$ServicePrefix-booking"
Write-Host "Deploying $BookingApp..." -ForegroundColor Yellow
& gcloud run deploy $BookingApp `
    --image=$ImageTag `
    --region=$Region `
    --platform=managed `
    --no-allow-unauthenticated `
    --no-cpu-throttling `
    --command="sh" `
    --args="-c,python -m backend.booking_worker" `
    --memory=512Mi `
    --cpu=1 `
    --min-instances=1 `
    --max-instances=1 `
    --set-secrets="BOOKING_WORKER_DATABASE_URL=voice-booking-database-url:latest,CREDENTIAL_BROKER_SHARED_SECRET=voice-broker-secret:latest" `
    --set-env-vars="APP_ENV=production,NEON_BRANCH=production,BOOKING_WORKER_DB_ROLE=calendar_booking_worker,CREDENTIAL_BROKER_URL=$BrokerUrl"

# 6d. LiveKit Worker
$WorkerApp = "$ServicePrefix-worker"
Write-Host "Deploying $WorkerApp..." -ForegroundColor Yellow
& gcloud run deploy $WorkerApp `
    --image=$ImageTag `
    --region=$Region `
    --platform=managed `
    --no-allow-unauthenticated `
    --no-cpu-throttling `
    --command="sh" `
    --args="-c,python agent/agent.py start" `
    --memory=1024Mi `
    --cpu=1 `
    --min-instances=1 `
    --max-instances=1 `
    --set-secrets="GOOGLE_API_KEY=voice-google-api-key:latest,LIVEKIT_API_SECRET=voice-livekit-api-secret:latest,LIVEKIT_SESSION_CONTEXT_SECRET=voice-context-secret:latest" `
    --set-env-vars="APP_ENV=production,LIVEKIT_URL=wss://ai-voice-assistant-vu6rr406.livekit.cloud,LIVEKIT_API_KEY=API6cHSaYkSN7qB,LIVEKIT_AGENT_NAME=calendar-assistant,BACKEND_URL=$ApiUrl"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host " Voice API URL:         $ApiUrl"
Write-Host " Credential Broker URL: $BrokerUrl"
Write-Host ""
Write-Host " IMPORTANT:" -ForegroundColor Yellow
Write-Host " 1. Add this Authorized Redirect URI to your Google Cloud OAuth Client:"
Write-Host "    $ApiUrl/auth/google/callback"
Write-Host " 2. In your Next.js Frontend, set BACKEND_URL to:"
Write-Host "    $ApiUrl"
Write-Host "========================================================" -ForegroundColor Cyan
