# Google Cloud Run Deployment Guide

This directory contains the automated deployment manifests, scripts, and documentation for deploying the **AI Voice Bot** backend to **Google Cloud Run** in project `project-b41c2c97-b828-4d42-a59`.

---

## 1. System Architecture on Google Cloud

```text
Browser 
  │ (HTTPS)
  ▼
[Next.js Frontend] (Vercel / Cloud Run / SSR)
  │ (HTTPS REST & OAuth Proxy)
  ▼
[voice-api] (Google Cloud Run - Public HTTPS, Port 8080)
  │
  ├───► Neon PostgreSQL (ai_voice_bot_runtime role with RLS)
  │
  └───► [voice-broker] (Google Cloud Run - Private / IAM Authenticated + HMAC)
          ├───► Google Calendar API
          └───► Neon PostgreSQL (Encrypted OAuth Tokens)

[voice-booking] (Google Cloud Run - Persistent Daemon, CPU Always Allocated)
  └───► Neon PostgreSQL (calendar_booking_worker role, dedicated queue)

[voice-worker] (Google Cloud Run - Persistent Daemon, CPU Always Allocated)
  ├───► LiveKit Cloud (Outbound WebSockets)
  ├───► Google Gemini 2.0 Multimodal Live API
  └───► [voice-api] (HTTP Tool Execution Dispatch)
```

---

## 2. Microservice Manifest

| Service | Cloud Run Ingress | Scaling / CPU | Start Command | Memory / CPU |
| :--- | :--- | :--- | :--- | :--- |
| **Voice API** (`voice-api`) | Public (Unauthenticated) | Autoscaling (`min=1`, `max=10`) | `python -m uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT` | 512 MiB / 1 CPU |
| **Credential Broker** (`voice-broker`) | Internal / Authenticated | Autoscaling (`min=0`, `max=5`) | `python -m uvicorn backend.credential_broker.main:app --host 0.0.0.0 --port $PORT` | 512 MiB / 1 CPU |
| **Booking Worker** (`voice-booking`) | Internal | Persistent (`min=1`, `max=1`, CPU always allocated) | `python -m backend.booking_worker` | 512 MiB / 1 CPU |
| **LiveKit Worker** (`voice-worker`) | Internal | Persistent (`min=1`, `max=1`, CPU always allocated) | `python agent/agent.py start` | 1024 MiB / 1 CPU |

---

## 3. Quick Deployment Options

### Option A: One-Command Deployment via Google Cloud Shell (Recommended)

Google Cloud Shell has `gcloud` and `git` pre-installed and authenticated:

1. Open Google Cloud Shell for your project:
   👉 **[Open Google Cloud Shell](https://shell.cloud.google.com/?project=project-b41c2c97-b828-4d42-a59)**
2. Clone your repository (if not already cloned):
   ```bash
   git clone <your-repo-url>
   cd AI-Voice-Assistants
   ```
3. Run the deployment script:
   ```bash
   chmod +x ./infra/gcp/deploy-cloudrun.sh ./infra/gcp/set-secrets-gcp.sh
   ./infra/gcp/deploy-cloudrun.sh
   ```
The script will automatically:
- Enable all required Google Cloud APIs (`run`, `cloudbuild`, `artifactregistry`, `secretmanager`).
- Create and provision Secret Manager entries with database and API keys.
- Build the container image using Google Cloud Build (zero local Docker needed).
- Deploy and interconnect all 4 microservices on Cloud Run.

---

### Option B: Deploying via Google Cloud Console UI

From the Google Cloud Run console link:  
👉 **[Google Cloud Run Console](https://console.cloud.google.com/welcome/new?project=project-b41c2c97-b828-4d42-a59&facet_url=https:%2F%2Fcloud.google.com%2Frun)**

#### 1. Enable Services
Go to **APIs & Services** and enable:
- Cloud Run Admin API
- Cloud Build API
- Artifact Registry API
- Secret Manager API

#### 2. Create the Secret Manager Secrets
Go to **Security &rarr; Secret Manager** and create the following secrets:
- `voice-database-url`: Your Neon connection string for runtime role
- `voice-booking-database-url`: Your Neon connection string for booking role
- `voice-broker-secret`: HMAC shared secret
- `voice-context-secret`: LiveKit session context signing key
- `voice-oauth-state-secret`: Google OAuth state secret
- `voice-google-client-secret`: Google OAuth Client secret
- `voice-encryption-key`: 32-byte URL-safe base64 encryption key
- `voice-livekit-api-secret`: LiveKit server API secret
- `voice-google-api-key`: Gemini Live Google API key

#### 3. Deploy `voice-api`
- Click **Create Service**.
- Select **Continuously deploy from a repository** &rarr; Select your GitHub repo & root `Dockerfile`.
- Service name: `voice-api`.
- Region: `us-central1` (or your choice).
- Authentication: **Allow unauthenticated invocations**.
- Under **Container, Volumes, Networking, Security**:
  - Container port: `8080`.
  - Min instances: `1`.
  - Reference the secrets from Secret Manager (`DATABASE_URL`, `LIVEKIT_API_SECRET`, etc.).
- Click **Create**.

#### 4. Deploy `voice-broker`
- Click **Create Service**.
- Service name: `voice-broker`.
- Authentication: **Require authentication**.
- Command / args: `python -m uvicorn backend.credential_broker.main:app --host 0.0.0.0 --port 8080`.
- Reference required secrets (`DATABASE_URL`, `CREDENTIAL_BROKER_SHARED_SECRET`, `GOOGLE_CLIENT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`).

#### 5. Deploy `voice-worker` and `voice-booking`
- For persistent background workers, make sure to check:
  - **CPU allocation**: Select **"CPU is always allocated"** (`--no-cpu-throttling`).
  - **Min instances**: Set to `1`.
  - Commands:
    - Worker: `python agent/agent.py start`
    - Booking: `python -m backend.booking_worker`

---

## 4. Google OAuth Configuration

After deployment, copy the public URL of `voice-api` (e.g., `https://voice-api-xxxxx-uc.a.run.app`).

1. Go to **Google Cloud Console &rarr; APIs & Services &rarr; Credentials**.
2. Click your OAuth 2.0 Client ID (`921027457755-kf4epo0unnhnhno0ug71jepv5bo52um0.apps.googleusercontent.com`).
3. Under **Authorized redirect URIs**, ensure you have:
   ```text
   https://<your-frontend-domain>/auth/google/callback
   ```
   *(If the frontend proxies to the backend, keep your frontend domain. If calling the backend directly, add `https://voice-api-xxxxx-uc.a.run.app/auth/google/callback`)*.
4. Under **Authorized JavaScript origins**, add your frontend origin and API origin.
