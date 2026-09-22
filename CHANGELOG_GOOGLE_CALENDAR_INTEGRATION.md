# Google Calendar OAuth 2.0 & Live Tool Integration Changelog

> **Historical implementation log, not a current deployment or security
> guide.** This predates tenant-bound OAuth state, broker-isolated token
> encryption, Neon Auth identity, and the current capability compiler. Do not
> copy its old `user_id` examples, migration sequence, or environment guidance.
> For current requirements see [the Google Calendar security plan](docs/GOOGLE_CALENDAR_SECURITY_PLAN.md),
> [credential broker boundary](docs/CREDENTIAL_BROKER.md), and
> [implementation status](docs/IMPLEMENTATION_STATUS.md).

This document explains every modification and new component created to integrate **Google Calendar OAuth 2.0 credentials**, token persistence in **Neon Serverless PostgreSQL**, and live calendar tool execution into the **AI Voice Bot** platform.

It outlines what was changed or added, the technical rationale behind each addition, and how each component operates within our low-latency voice pipeline.

---

## Table of Contents

1. [Architectural Context & Design Decisions](#1-architectural-context--design-decisions)
2. [Configuration Layer](#2-configuration-layer)
   - [`.env`](#21-env)
   - [`backend/app/config.py`](#22-backendappconfigpy)
3. [Database & Persistence Layer](#3-database--persistence-layer)
   - [`db/migrations/002_oauth_tokens.sql` (New Migration)](#31-dbmigrations002_oauth_tokenssql-new-migration)
   - [`db/tokens.py` (New Repository)](#32-dbtokenspy-new-repository)
4. [Google Services Layer](#4-google-services-layer)
   - [`backend/app/services/google_oauth.py` (New Service)](#41-backendappservicesgoogle_oauthpy-new-service)
   - [`backend/app/services/google_calendar.py` (New Service)](#42-backendappservicesgoogle_calendarpy-new-service)
5. [API & Dispatcher Layer](#5-api--dispatcher-layer)
   - [`backend/app/api/auth.py` (New Router)](#51-backendappapiauthpy-new-router)
   - [`backend/app/main.py`](#52-backendappmainpy)
   - [`backend/app/api/tools.py`](#53-backendappapitoolspy)
   - [`backend/app/tools/calendar.py`](#54-backendapptoolscalendarpy)
6. [Summary Matrix of Changes](#6-summary-matrix-of-changes)
7. [Step-by-Step Verification & Testing Guide](#7-step-by-step-verification--testing-guide)

---

## 1. Architectural Context & Design Decisions

### The Challenge

A voice assistant requires seamless, real-time access to a user's calendar while maintaining conversational response times:

1. **Sub-400ms Voice Budget (ADR-002 & ADR-003):** Standard blocking Python SDK calls (`google-api-python-client`) stall the asyncio event loop. Every HTTP interaction with Google APIs must be fully asynchronous.
2. **Session Persistence (ADR-004):** Voice calls are ephemeral WebRTC sessions. User OAuth tokens must persist durably in **Neon PostgreSQL** so the bot does not ask the user to authenticate repeatedly.
3. **Offline Access & Token Expiry:** Google access tokens expire after 1 hour (3600 seconds). The backend must obtain a `refresh_token` during initial consent and silently auto-refresh expired access tokens without interrupting the user.
4. **Graceful Fallback:** If a developer or tester has not authenticated their Google account yet, the assistant must fall back seamlessly to simulated realistic data rather than crashing the voice conversation.

---

## 2. Configuration Layer

### 2.1. `.env`

#### What Changed

Replaced placeholder strings with actual Google OAuth credentials and registered the local redirect callback URI:

```env
# Before:
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret

# After (in .env):
GOOGLE_CLIENT_ID=921027457755-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
```

#### Why It Was Added & What It Does

- **`GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`**: Identifies our backend application securely to Google's OAuth 2.0 authorization servers.
- **`GOOGLE_REDIRECT_URI`**: The exact callback URI whitelisted in Google Cloud Console (`http://localhost:8000/auth/google/callback`). Ensures token exchanges pass Google's strict redirect URI validation.

---

### 2.2. `backend/app/config.py`

#### What Changed

Added `google_redirect_uri` to the Pydantic `Settings` model.

```python
# Added to Settings class:
google_redirect_uri: str = Field(
    default="http://localhost:8000/auth/google/callback",
    validation_alias="GOOGLE_REDIRECT_URI",
)
```

#### Why It Was Added & What It Does

- Exposes typed access to `settings.google_redirect_uri` across all backend services with fallback defaults.
- Prevents hardcoded URLs across the codebase, simplifying environment promotion (development $\rightarrow$ staging $\rightarrow$ production).

---

## 3. Database & Persistence Layer

### 3.1. `db/migrations/002_oauth_tokens.sql` (New Migration)

#### File Contents

```sql
-- ==============================================================================
-- AI VOICE BOT — OAuth Tokens Schema Migration
-- Migration: 002_oauth_tokens.sql
-- Lead Architect: Anesu Mupesa (ANE-02) / Collaborator 1 (DEL-05)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'google',
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type VARCHAR(32) DEFAULT 'Bearer',
    scope TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_oauth_user_provider UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_provider ON oauth_tokens (user_id, provider);

DROP TRIGGER IF EXISTS trg_oauth_tokens_updated_at ON oauth_tokens;
CREATE TRIGGER trg_oauth_tokens_updated_at
    BEFORE UPDATE ON oauth_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
```

#### Why It Was Added & What It Does

- **Durable Token Storage:** Stores the `access_token` and the long-lived `refresh_token` associated with each `user_id`.
- **Constraint `uq_oauth_user_provider`:** Guarantees one active token record per user per provider, enabling safe `ON CONFLICT DO UPDATE` operations.
- **`idx_oauth_tokens_user_provider`:** Accelerates query execution when retrieving credentials during voice tool dispatches (<2ms).
- **Auto-updating Trigger:** Reuses the database `update_timestamp()` trigger created in migration 001 to keep `updated_at` accurate whenever tokens are refreshed.

---

### 3.2. `db/tokens.py` (New Repository)

#### Key Functions

- `save_oauth_tokens(user_id, provider, access_token, expires_at, refresh_token, token_type, scope)`
- `get_oauth_tokens(user_id, provider)`
- `delete_oauth_tokens(user_id, provider)`

#### Why It Was Added & What It Does

- **Atomic UPSERT with Refresh Token Protection:** Google only returns a `refresh_token` during initial consent or when `prompt=consent` is specified. When renewing tokens later, Google often returns only a fresh `access_token`. Our SQL query uses:
  ```sql
  refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token)
  ```
  This guarantees that an existing refresh token is **never accidentally overwritten by null** during subsequent updates.
- **Connection Pool Integration:** Queries execute through `get_db_pool()` in [db/connection.py](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/connection.py), utilizing Neon's PgBouncer transaction pooler.

---

## 4. Google Services Layer

### 4.1. `backend/app/services/google_oauth.py` (New Service)

#### Key Functions

- `get_authorization_url(user_id, redirect_uri, scopes)`
- `exchange_code_for_tokens(code, redirect_uri)`
- `get_valid_access_token(user_id)`
- `refresh_access_token(refresh_token)`
- `revoke_and_disconnect(user_id)`

#### Why It Was Added & What It Does

- **Consent URL Generation:** Appends `access_type=offline` and `prompt=consent` to guarantee a refresh token, and embeds `{"user_id": user_id}` into the URL `state` parameter to prevent CSRF attacks and link callback redirects to the right user.
- **Transparent Token Auto-Refresh:** Before any tool call, `get_valid_access_token()` checks if the token expires within 60 seconds. If expired, it calls Google's token endpoint, updates Neon PostgreSQL, and returns the new valid token without the user ever noticing.
- **Asynchronous Execution:** Uses `httpx.AsyncClient` for all outbound calls, keeping the FastAPI event loop unblocked.

---

### 4.2. `backend/app/services/google_calendar.py` (New Service)

#### Key Functions

- `get_google_calendar_availability(user_id, start_date, end_date, duration_minutes)`
- `book_google_calendar_event(user_id, title, start_time, duration_minutes, attendees, description, location)`
- `_compute_free_slots(base_date, busy_periods, duration_minutes)`

#### Why It Was Added & What It Does

- **Free/Busy Slot Calculation:** Calls `POST https://www.googleapis.com/calendar/v3/freeBusy` to inspect busy intervals on the user's primary calendar and calculates open slots across standard business hours (09:00–17:00 UTC).
- **Automated Google Meet Generation:** Calls `POST https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1` with:
  ```json
  "conferenceData": {
    "createRequest": {
      "conferenceSolutionKey": {"type": "hangoutsMeet"}
    }
  }
  ```
  This creates the calendar event and automatically provisions a real Google Meet video conferencing URL (`https://meet.google.com/...`).

---

## 5. API & Dispatcher Layer

### 5.1. `backend/app/api/auth.py` (New Router)

#### Endpoints

- `GET /auth/google/login`: Initiates a 307 temporary redirect directly to Google's consent screen.
- `GET /auth/google/url`: Returns authorization URL as JSON for frontend popups or buttons.
- `GET /auth/google/callback`: Receives the OAuth code from Google, exchanges it for tokens, stores them in Neon DB, and renders a dark-themed responsive success landing page.
- `GET /auth/google/status`: Returns JSON showing whether Google Calendar is currently connected and active.
- `POST /auth/google/disconnect`: Revokes the token with Google and cleans up database records.

---

### 5.2. `backend/app/main.py`

#### What Changed

1. Imported `auth_router`:
   ```python
   from .api.auth import router as auth_router
   ```
2. Mounted `auth_router` into the FastAPI application:
   ```python
   app.include_router(auth_router)
   ```

#### Why It Was Added & What It Does

Exposes all authentication routes at the `/auth/google/*` path prefix.

---

### 5.3. `backend/app/api/tools.py`

#### What Changed

Inspected the target tool's parameter signature before invocation:

```python
# In execute_tool():
import inspect
sig = inspect.signature(tool_func)
call_params = dict(request.parameters)
if "user_id" in sig.parameters and "user_id" not in call_params:
    call_params["user_id"] = request.user_id

result = await tool_func(**call_params)
```

#### Why It Was Added & What It Does

The voice agent sends `user_id` at the top level of `ToolExecutionRequest`, while tool arguments reside in `parameters`. This logic injects `user_id` into tools that require user authentication (like Calendar and Contacts) while preserving backwards compatibility for tools that do not take a `user_id`.

---

### 5.4. `backend/app/tools/calendar.py`

#### What Changed

Connected `get_calendar_availability` and `book_event` to the live `google_calendar` service:

```python
# Check live Google Calendar first
if settings.google_client_id and settings.google_client_secret:
    live_result = await get_google_calendar_availability(
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        duration_minutes=duration_minutes,
    )
    if live_result:
        return live_result

# Fallback to simulated mock if tokens are not present
...
```

#### Why It Was Added & What It Does

- When a user has connected their Google Calendar, tool execution queries and writes real Google Calendar data.
- If a user has not yet authenticated, the system smoothly falls back to simulated realistic slots with ~120ms artificial latency, preventing voice bot failures during development or offline testing.

---

## 6. Summary Matrix of Changes

| File                                                                                                                                               | Type     | Primary Purpose        | Key Components / Changes                                                             |
| :------------------------------------------------------------------------------------------------------------------------------------------------- | :------- | :--------------------- | :----------------------------------------------------------------------------------- |
| [`.env`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/.env)                                                                       | Modified | Credential Storage     | Added `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.             |
| [`backend/app/config.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/config.py)                                     | Modified | Settings Type Model    | Added `google_redirect_uri` configuration property.                                  |
| [`db/migrations/002_oauth_tokens.sql`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/migrations/002_oauth_tokens.sql)           | **New**  | Database Migration     | Created `oauth_tokens` table with constraints, indices, and auto-update trigger.     |
| [`db/tokens.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/tokens.py)                                                       | **New**  | Database Repository    | Token CRUD operations with `COALESCE` protection for refresh tokens.                 |
| [`backend/app/services/google_oauth.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/services/google_oauth.py)       | **New**  | OAuth Service          | Authorization URL builder, token code exchange, auto-refresh, and revocation.        |
| [`backend/app/services/google_calendar.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/services/google_calendar.py) | **New**  | Calendar REST Service  | Free/busy slot calculation and event scheduling with Google Meet integration.        |
| [`backend/app/api/auth.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/api/auth.py)                                 | **New**  | API Router             | `/login`, `/callback`, `/status`, `/disconnect` endpoints and callback landing page. |
| [`backend/app/main.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/main.py)                                         | Modified | Application Entrypoint | Registered and mounted `auth_router` under `/auth/google`.                           |
| [`backend/app/api/tools.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/api/tools.py)                               | Modified | Tool Dispatcher        | Injected `user_id` into tool functions matching signature.                           |
| [`backend/app/tools/calendar.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/tools/calendar.py)                     | Modified | Voice Tool Functions   | Live Google Calendar execution with graceful fallback to simulated mock.             |

---

## 7. Step-by-Step Verification & Testing Guide

### 1. Apply Migrations to Neon Database

```powershell
python -m db.migrate
```

_Expected Result:_ `Successfully applied 002_oauth_tokens.sql`. Active public tables includes `oauth_tokens`.

### 2. Start the Backend Service

```powershell
python -m uvicorn backend.app.main:app --reload --port 8000
```

### 3. Authenticate in Browser

1. Navigate to:
   ```text
   http://localhost:8000/auth/google/login
   ```
2. Sign in with the Google Account registered under your GCP project's **Test Users** list.
3. Grant calendar access on the consent screen.
4. Verify you land on the **"Google Calendar Connected"** success screen.

### 4. Verify Connection Status

Run in terminal:

```powershell
curl http://localhost:8000/auth/google/status
```

_Expected Output:_

```json
{
  "connected": true,
  "provider": "google",
  "user_id": "00000000-0000-0000-0000-000000000001",
  "expires_at": "2026-09-17T17:34:00+00:00",
  "is_expired": false,
  "can_refresh": true
}
```

### 5. Test Live Calendar Tool Call

```powershell
curl -X POST http://localhost:8000/tools/execute `
  -H "Content-Type: application/json" `
  -d '{\"tool_name\": \"get_calendar_availability\", \"parameters\": {\"start_date\": \"2026-09-20\"}}'
```

_Expected Output:_
Returns slots calculated from your real calendar with `"source": "google_calendar_live"`.
