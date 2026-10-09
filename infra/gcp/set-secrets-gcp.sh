#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Setup Google Cloud Secret Manager Secrets for AI Voice Bot
# Target Project: project-b41c2c97-b828-4d42-a59
# ==============================================================================

PROJECT_ID="${1:-${GCP_PROJECT_ID:-project-b41c2c97-b828-4d42-a59}}"

# Load from .env if present
if [ -f ".env" ]; then
  echo "Loading secret values from .env file..."
  # Export non-comment lines
  set -a
  source <(grep -v '^#' .env | grep -v '^\s*$')
  set +a
fi

echo "Setting up Google Cloud Secret Manager secrets in project: $PROJECT_ID..."

upsert_secret() {
  local secret_name="$1"
  local secret_value="${2:-}"

  if [ -z "$secret_value" ]; then
    echo "Warning: No value provided for secret '$secret_name'. Skipping or prompt required."
    return 0
  fi

  if ! gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &>/dev/null; then
    echo "Creating secret: $secret_name"
    printf "%s" "$secret_value" | gcloud secrets create "$secret_name" \
      --project="$PROJECT_ID" \
      --replication-policy="automatic" \
      --data-file=-
  else
    echo "Updating secret: $secret_name (adding new version)"
    printf "%s" "$secret_value" | gcloud secrets versions add "$secret_name" \
      --project="$PROJECT_ID" \
      --data-file=-
  fi
}

upsert_secret "voice-database-url" "${DATABASE_URL:-}"
upsert_secret "voice-booking-database-url" "${BOOKING_WORKER_DATABASE_URL:-}"
upsert_secret "voice-broker-secret" "${CREDENTIAL_BROKER_SHARED_SECRET:-}"
upsert_secret "voice-context-secret" "${LIVEKIT_SESSION_CONTEXT_SECRET:-}"
upsert_secret "voice-oauth-state-secret" "${GOOGLE_OAUTH_STATE_SECRET:-}"
upsert_secret "voice-google-client-secret" "${GOOGLE_CLIENT_SECRET:-}"
upsert_secret "voice-encryption-key" "${CREDENTIAL_ENCRYPTION_KEY:-}"
upsert_secret "voice-livekit-api-secret" "${LIVEKIT_API_SECRET:-}"
upsert_secret "voice-google-api-key" "${GOOGLE_API_KEY:-}"

# Grant the Compute Engine default service account access to read secrets
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
COMPUTE_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

echo "Granting Secret Accessor permissions to Cloud Run runtime service account ($COMPUTE_SA)..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$COMPUTE_SA" \
  --role="roles/secretmanager.secretAccessor" &>/dev/null || true

echo "Google Cloud Secret Manager configuration complete!"
