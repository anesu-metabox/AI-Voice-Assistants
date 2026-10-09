#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Google Cloud Run Deployment Script for AI Voice Bot Backend
# Target Project: project-b41c2c97-b828-4d42-a59
# ==============================================================================

PROJECT_ID="${GCP_PROJECT_ID:-project-b41c2c97-b828-4d42-a59}"
REGION="${GCP_REGION:-us-central1}"
REPO_NAME="voice-bot"
SERVICE_PREFIX="${APP_PREFIX:-voice}"

# Source .env if present
if [ -f ".env" ]; then
  echo "Loading environment configuration from .env..."
  set -a
  source <(grep -v '^#' .env | grep -v '^\s*$')
  set +a
fi

LIVEKIT_URL="${LIVEKIT_URL:-wss://ai-voice-assistant-vu6rr406.livekit.cloud}"
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-921027457755-kf4epo0unnhnhno0ug71jepv5bo52um0.apps.googleusercontent.com}"
CORS_ORIGINS="${CORS_ORIGINS:-*}"

echo "========================================================"
echo " Starting Google Cloud Run Multi-Service Deployment"
echo " Project: $PROJECT_ID"
echo " Region:  $REGION"
echo " Prefix:  $SERVICE_PREFIX"
echo "========================================================"

# 1. Configure active project
gcloud config set project "$PROJECT_ID"

# 2. Enable Required Google Cloud APIs
echo -e "\n==> [1/6] Enabling Required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com

# 3. Create Artifact Registry Repository if it doesn't exist
echo -e "\n==> [2/6] Ensuring Artifact Registry repository exists..."
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" &>/dev/null; then
  echo "Creating Docker repository '$REPO_NAME' in '$REGION'..."
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Docker repository for AI Voice Bot backend"
else
  echo "Artifact Registry repository '$REPO_NAME' already exists."
fi

# 4. Set up Secrets in Secret Manager if needed
echo -e "\n==> [3/6] Setting up Secret Manager entries..."
chmod +x ./infra/gcp/set-secrets-gcp.sh 2>/dev/null || true
if [ -f "./infra/gcp/set-secrets-gcp.sh" ]; then
  ./infra/gcp/set-secrets-gcp.sh "$PROJECT_ID"
fi

# 5. Build Unified Image via Cloud Build (No local Docker needed!)
IMAGE_TAG="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/backend:latest"
echo -e "\n==> [4/6] Building unified backend image with Google Cloud Build..."
gcloud builds submit --tag "$IMAGE_TAG" .

# 6. Deploy the 4 Services to Cloud Run
echo -e "\n==> [5/6] Deploying Services to Cloud Run..."

# 6a. Credential Broker (Internal, authenticated only)
echo "Deploying $SERVICE_PREFIX-broker..."
gcloud run deploy "$SERVICE_PREFIX-broker" \
  --image="$IMAGE_TAG" \
  --region="$REGION" \
  --platform=managed \
  --no-allow-unauthenticated \
  --ingress=all \
  --command="sh" \
  --args="-c,python -m uvicorn backend.credential_broker.main:app --host 0.0.0.0 --port \$PORT" \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --set-secrets="DATABASE_URL=voice-database-url:latest,CREDENTIAL_BROKER_SHARED_SECRET=voice-broker-secret:latest,GOOGLE_CLIENT_SECRET=voice-google-client-secret:latest,CREDENTIAL_ENCRYPTION_KEY=voice-encryption-key:latest" \
  --set-env-vars="APP_ENV=production,NEON_BRANCH=production,RUNTIME_DB_ROLE=ai_voice_bot_runtime,CREDENTIAL_KEY_PROVIDER=env,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"

BROKER_URL=$(gcloud run services describe "$SERVICE_PREFIX-broker" --region="$REGION" --format='value(status.url)')
echo "Broker deployed at: $BROKER_URL"

# 6b. General Voice API (Public entrypoint)
echo "Deploying $SERVICE_PREFIX-api..."
gcloud run deploy "$SERVICE_PREFIX-api" \
  --image="$IMAGE_TAG" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --command="sh" \
  --args="-c,python -m uvicorn backend.app.main:app --host 0.0.0.0 --port \$PORT" \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=10 \
  --set-secrets="DATABASE_URL=voice-database-url:latest,LIVEKIT_API_SECRET=voice-livekit-api-secret:latest,LIVEKIT_SESSION_CONTEXT_SECRET=voice-context-secret:latest,GOOGLE_OAUTH_STATE_SECRET=voice-oauth-state-secret:latest,CREDENTIAL_BROKER_SHARED_SECRET=voice-broker-secret:latest" \
  --set-env-vars="APP_ENV=production,NEON_BRANCH=production,RUNTIME_DB_ROLE=ai_voice_bot_runtime,LIVEKIT_URL=$LIVEKIT_URL,LIVEKIT_API_KEY=$LIVEKIT_API_KEY,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,CREDENTIAL_BROKER_URL=$BROKER_URL,CORS_ORIGINS=$CORS_ORIGINS"

API_URL=$(gcloud run services describe "$SERVICE_PREFIX-api" --region="$REGION" --format='value(status.url)')
echo "Voice API deployed at: $API_URL"

# 6c. Calendar Booking Worker (Background daemon: min-instances=1, CPU always allocated)
echo "Deploying $SERVICE_PREFIX-booking..."
gcloud run deploy "$SERVICE_PREFIX-booking" \
  --image="$IMAGE_TAG" \
  --region="$REGION" \
  --platform=managed \
  --no-allow-unauthenticated \
  --no-cpu-throttling \
  --command="sh" \
  --args="-c,python -m backend.booking_worker" \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=10 \
  --set-secrets="BOOKING_WORKER_DATABASE_URL=voice-booking-database-url:latest,CREDENTIAL_BROKER_SHARED_SECRET=voice-broker-secret:latest" \
  --set-env-vars="APP_ENV=production,NEON_BRANCH=production,BOOKING_WORKER_DB_ROLE=calendar_booking_worker,CREDENTIAL_BROKER_URL=$BROKER_URL"

# 6d. LiveKit Voice Agent Worker (WebSocket daemon: min-instances=1, CPU always allocated)
echo "Deploying $SERVICE_PREFIX-worker..."
gcloud run deploy "$SERVICE_PREFIX-worker" \
  --image="$IMAGE_TAG" \
  --region="$REGION" \
  --platform=managed \
  --no-allow-unauthenticated \
  --no-cpu-throttling \
  --command="sh" \
  --args="-c,python agent/agent.py start" \
  --memory=1024Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=1 \
  --set-secrets="GOOGLE_API_KEY=voice-google-api-key:latest,LIVEKIT_API_SECRET=voice-livekit-api-secret:latest,LIVEKIT_SESSION_CONTEXT_SECRET=voice-context-secret:latest" \
  --set-env-vars="APP_ENV=production,LIVEKIT_URL=$LIVEKIT_URL,LIVEKIT_API_KEY=$LIVEKIT_API_KEY,LIVEKIT_AGENT_NAME=calendar-assistant,BACKEND_URL=$API_URL"

echo -e "\n==> [6/6] Verifying Deployment Status..."
echo "Voice API Health Check:"
curl -s "$API_URL/health" || true

echo -e "\n========================================================"
echo " DEPLOYMENT COMPLETE!"
echo " Public Voice API URL: $API_URL"
echo " Credential Broker URL: $BROKER_URL"
echo ""
echo " IMPORTANT: Add this to Google Cloud OAuth Authorized Redirect URIs:"
echo "   $API_URL/auth/google/callback"
echo "   (or your frontend URL + /auth/google/callback if using frontend proxy)"
echo "========================================================"
