# React/Vite to Next.js Migration Plan

## Goal

Make the Elihu dashboard the active Next.js App Router home page while preserving dormant voice compatibility code and existing backend contracts.

## Frontend runtime

- Use Next.js 14.2.11 and React 18.3.1.
- Keep TypeScript, Tailwind, LiveKit, Gemini, and existing UI dependencies.
- Use `dev`, `build`, `start`, `lint`, `typecheck`, and `test` scripts.
- Use port 3000 locally.
- Keep the dashboard as a client-side state-driven interface at `/`.

## Routes

Add or preserve Next handlers for:

- `/api/assistant-config`
- `/api/company-profile`
- `/api/livekit/token`
- `/api/tools/execute`
- `/api/tasks/:taskId` while legacy compatibility remains
- `/auth/google/*` rewrites through the backend

Server-only proxy code uses `BACKEND_URL`. Browser-visible variables use public prefixes only where required.

## Compatibility

- Keep voice hooks, audio components, policy files, LiveKit helpers, and dormant handlers.
- Do not expose the old voice page as `/`.
- Do not create `/voice` unless requested.
- Preserve backend response schemas while authentication and tenant ownership are introduced.

## Verification

- Install dependencies from the Next lockfile.
- Run typecheck, tests, and production build.
- Verify landing, onboarding, dashboard navigation, settings, Google flow, LiveKit sandbox, tool restrictions, and backend health.
