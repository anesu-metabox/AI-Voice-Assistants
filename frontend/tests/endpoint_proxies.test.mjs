import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, "../..");
const frontendDir = resolve(testDir, "..");

describe("FastAPI & Next.js Endpoints Integration Verification", () => {
  it("uses the Elihu dashboard as the Next.js home page", () => {
    const pagePath = resolve(frontendDir, "src/app/page.tsx");
    assert.ok(existsSync(pagePath), "Next home page must exist");
    const content = readFileSync(pagePath, "utf-8");
    assert.match(content, /from ["']@\/App["']/);
    assert.match(content, /return <App \/>/);
  });

  it("provides Next proxy routes for dashboard settings and LiveKit", () => {
    for (const route of [
      "src/app/api/assistant-config/route.ts",
      "src/app/api/assistant-config/runtime/route.ts",
      "src/app/api/company-profile/route.ts",
      "src/app/api/livekit/token/route.ts",
    ]) {
      assert.ok(existsSync(resolve(frontendDir, route)), `${route} must exist`);
    }
  });

  it("provides a same-origin Neon Auth surface without trusting browser tenant IDs", () => {
    const authProxy = resolve(frontendDir, "src/app/api/auth/[...path]/route.ts");
    const signInPage = resolve(frontendDir, "src/app/sign-in/page.tsx");
    assert.ok(existsSync(authProxy), "Neon Auth BFF route must exist");
    assert.ok(existsSync(signInPage), "Sign-in page must exist");
    const proxyContent = readFileSync(authProxy, "utf-8");
    assert.match(proxyContent, /NEON_AUTH_URL/);
    assert.match(proxyContent, /isSameOriginMutation/);
    assert.match(proxyContent, /"origin"/);
    assert.match(proxyContent, /set-cookie/);
    assert.doesNotMatch(proxyContent, /user_id|company_id/);
    assert.match(proxyContent, /getSetCookie\?\.bind\(response\.headers\)/);
    const signInContent = readFileSync(signInPage, "utf-8");
    assert.match(signInContent, /sign-in\/email/);
    assert.match(signInContent, /sign-up\/email/);
    assert.match(signInContent, /new URL\("\/", window\.location\.origin\)\.toString\(\)/);
    assert.match(signInContent, /callbackURL/);
    assert.match(signInContent, /\/api\/auth\/get-session/);
    assert.match(signInContent, /router\.replace\("\/"\)/);
    assert.match(signInContent, /session was not saved/);
  });

  it("checks mutation origins against the configured public app origin behind a reverse proxy", () => {
    const proxyContent = readFileSync(resolve(frontendDir, "src/lib/backendProxy.ts"), "utf-8");
    assert.match(proxyContent, /process\.env\.APP_ORIGIN/);
    assert.match(proxyContent, /normalizeOrigin\(request\.headers\.get\("origin"\)\)/);
    assert.match(proxyContent, /origin === expectedOrigin/);
    assert.match(readFileSync(resolve(rootDir, ".env.example"), "utf-8"), /APP_ORIGIN=http:\/\/localhost:3000/);
  });

  it("shows the authenticated Neon Auth identity and terminates the session through its BFF", () => {
    const appSource = readFileSync(resolve(frontendDir, "src/App.tsx"), "utf-8");
    assert.match(appSource, /function AccountFooter/);
    assert.match(appSource, /\/api\/auth\/get-session/);
    assert.match(appSource, /\/api\/auth\/sign-out/);
    assert.match(appSource, /window\.location\.assign\("\/sign-in"\)/);
    assert.doesNotMatch(appSource, /Signed-in company|Authenticated workspace/);
  });

  it("routes an authenticated session out of the public landing state before loading company data", () => {
    const appSource = readFileSync(resolve(frontendDir, "src/App.tsx"), "utf-8");
    assert.match(appSource, /fetch\("\/api\/auth\/get-session"/);
    assert.match(appSource, /sessionPayload\?\.user \|\| sessionPayload\?\.session\?\.user/);
    assert.match(appSource, /setPage\("onboarding-goals"\)/);
    assert.match(appSource, /fetch\("\/api\/company-profile"/);
  });

  it("forwards single-segment Google OAuth paths without throwing in Next", () => {
    const routePath = resolve(frontendDir, "src/app/auth/google/[path]/route.ts");
    const content = readFileSync(routePath, "utf-8");
    assert.match(content, /params:\s*Promise<\{\s*path:\s*string\s*\}>/);
    assert.match(content, /const \{ path \} = await context\.params/);
    assert.match(content, /\/auth\/google\/\$\{path\}/);
    assert.doesNotMatch(content, /path\.join/);
  });

  it("gives idempotent LiveKit session creation a longer timeout and one retry", () => {
    const routePath = resolve(frontendDir, "src/app/api/livekit/token/route.ts");
    const content = readFileSync(routePath, "utf-8");
    assert.match(content, /timeoutMs:\s*30000/);
    assert.match(content, /retries:\s*1/);

    const proxyPath = resolve(frontendDir, "src/lib/backendProxy.ts");
    const proxyContent = readFileSync(proxyPath, "utf-8");
    assert.match(proxyContent, /cache:\s*["']no-store["']/);
    assert.match(proxyContent, /cache-control["'],\s*["']no-store["']/);
    assert.match(proxyContent, /incomingUrl\.searchParams\.delete\("user_id"\)/);
    assert.doesNotMatch(proxyContent, /searchParams\.delete\(["']profile_version["']\)/);
    assert.match(proxyContent, /const targetUrl = `\$\{BACKEND_URL\}\$\{backendPath\}\$\{incomingUrl\.search\}`/);
  });

  it("verifies root .env contains essential FastAPI connection settings", () => {
    const envPath = resolve(rootDir, ".env");
    assert.ok(existsSync(envPath), "Root .env file must exist");
    const envContent = readFileSync(envPath, "utf-8");

    assert.match(envContent, /BACKEND_HOST=127\.0\.0\.1/, "BACKEND_HOST should be configured");
    assert.match(envContent, /BACKEND_PORT=8000/, "BACKEND_PORT should be configured");
    assert.match(envContent, /BACKEND_URL=http:\/\/127\.0\.0\.1:8000/, "BACKEND_URL should point to 8000");
    assert.match(envContent, /CORS_ORIGINS=.*localhost:3000/, "CORS_ORIGINS must permit Next.js port 3000");
  });

  it("verifies frontend/.env.local contains the internal backend URL", () => {
    const envLocalPath = resolve(frontendDir, ".env.local");
    assert.ok(existsSync(envLocalPath), "frontend/.env.local file must exist");
    const envContent = readFileSync(envLocalPath, "utf-8");

    assert.match(envContent, /BACKEND_URL=http:\/\/127\.0\.0\.1:8000/, "Internal BACKEND_URL must be configured");
  });

  it("verifies /api/tools/execute route implementation structure", () => {
    const routePath = resolve(frontendDir, "src/app/api/tools/execute/route.ts");
    assert.ok(existsSync(routePath), "Tools execute route file must exist");
    const content = readFileSync(routePath, "utf-8");

    assert.ok(content.includes("isAllowedCalendarTool"), "Must verify tools against assistant policy");
    assert.ok(content.includes("session_id"), "Must forward session_id to backend");
    assert.ok(content.includes("idempotency_key"), "Must forward idempotency_key to backend");
    assert.ok(content.includes("AbortSignal.timeout(15000)"), "Must enforce a request timeout");
    assert.doesNotMatch(content, /DEFAULT_USER_ID|00000000-0000-0000-0000-000000000001/);
    assert.doesNotMatch(content, /user_id\s*:/, "Tool requests must not accept a caller-selected user ID");
    assert.match(content, /authorization/);
    assert.match(content, /cookie/);
  });

  it("keeps frontend identity session-scoped and free of demo tenant data", () => {
    const sources = [
      "src/App.tsx",
      "src/components/sandbox/TestingSandboxPage.tsx",
      "src/components/auth/GoogleCalendarAuth.tsx",
      "src/app/api/tools/execute/route.ts",
    ];
    for (const sourcePath of sources) {
      const content = readFileSync(resolve(frontendDir, sourcePath), "utf-8");
      assert.doesNotMatch(content, /00000000-0000-0000-0000-000000000001/);
      assert.doesNotMatch(content, /Acme Operations|Marcus Vance|Ava Support|Charlie Sales/);
    }

    const appSource = readFileSync(resolve(frontendDir, "src/App.tsx"), "utf-8");
    const sandboxSource = readFileSync(resolve(frontendDir, "src/components/sandbox/TestingSandboxPage.tsx"), "utf-8");
    const googleSource = readFileSync(resolve(frontendDir, "src/components/auth/GoogleCalendarAuth.tsx"), "utf-8");
    assert.doesNotMatch(appSource, /(?:company-profile|assistant-config).*user_id=/);
    assert.doesNotMatch(sandboxSource, /user_id["'=]/);
    assert.doesNotMatch(googleSource, /user_id["'=]/);
    assert.match(appSource, /Indian\/Mauritius/);
    assert.match(googleSource, /email\?/);
  });

  it("persists the active onboarding flow through authenticated settings proxies", () => {
    const appSource = readFileSync(resolve(frontendDir, "src/App.tsx"), "utf-8");
    assert.match(appSource, /PersistedCompanyOnboardingPage/);
    assert.match(appSource, /PersistedAssistantOnboardingPage/);
    assert.match(appSource, /fetch\("\/api\/company-profile"/);
    assert.match(appSource, /fetch\("\/api\/assistant-config"/);
    assert.match(appSource, /is_deployed: publish/);
    assert.match(appSource, /Indian\/Mauritius/);
  });

  it("provides a tenant-scoped user preferences proxy", () => {
    const routePath = resolve(frontendDir, "src/app/api/user-preferences/route.ts");
    assert.ok(existsSync(routePath), "User preferences route must exist");
    const content = readFileSync(routePath, "utf-8");
    assert.match(content, /proxyBackend/);
    assert.match(content, /user-preferences/);
    assert.match(content, /export async function GET/);
    assert.match(content, /export async function PUT/);
  });

  it("requires a fresh Neon Auth session for every 3CX credential operation", () => {
    const route = readFileSync(resolve(frontendDir, "src/app/api/integrations/3cx/route.ts"), "utf-8");
    assert.match(route, /POST[\s\S]*requireRecentAuth:\s*true/);
    assert.match(route, /PUT[\s\S]*requireRecentAuth:\s*true/);
    assert.match(route, /DELETE[\s\S]*requireRecentAuth:\s*true/);
    const proxy = readFileSync(resolve(frontendDir, "src/lib/backendProxy.ts"), "utf-8");
    assert.match(proxy, /RECENT_AUTHENTICATION_REQUIRED/);
    assert.match(proxy, /10 \* 60 \* 1000/);
    const session = readFileSync(resolve(frontendDir, "src/lib/sessionContext.ts"), "utf-8");
    assert.match(session, /createdAt/);
    assert.match(session, /sessionCreatedAt: _sessionCreatedAt/);
  });

  it("provides a same-origin proxy for bounded 3CX call history", () => {
    const route = resolve(frontendDir, "src/app/api/integrations/3cx/calls/route.ts");
    assert.ok(existsSync(route));
    assert.match(readFileSync(route, "utf-8"), /proxyBackend\(request, ["']\/api\/integrations\/3cx\/calls["']\)/);
    const appSource = readFileSync(resolve(frontendDir, "src/App.tsx"), "utf-8");
    const callsPage = appSource.slice(appSource.indexOf("function CallsPage"), appSource.indexOf("function PhoneNumbersPage"));
    assert.match(callsPage, /\/api\/integrations\/3cx\/calls\?limit=50/);
    assert.doesNotMatch(callsPage, /(?:c|selected)\.(?:pbx_call_id|claim_token|livekit_room|transcriptText)/);
  });

  it("verifies /api/tasks/[taskId] route implementation structure", () => {
    const routePath = resolve(frontendDir, "src/app/api/tasks/[taskId]/route.ts");
    assert.ok(existsSync(routePath), "Tasks route proxy file must exist");
    const content = readFileSync(routePath, "utf-8");

    assert.ok(content.includes("export async function GET"), "Must export GET handler for task status");
    assert.ok(content.includes("export async function POST"), "Must export POST handler for task cancellation");
    assert.ok(content.includes("/status"), "Must route to /tasks/{taskId}/status");
    assert.ok(content.includes("/cancel"), "Must route to /tasks/{taskId}/cancel");
  });

  it("verifies TaskCard polls durable bookings and cancels through the matching endpoint", () => {
    const taskCardPath = resolve(frontendDir, "src/components/tasks/TaskCard.tsx");
    assert.ok(existsSync(taskCardPath), "TaskCard component must exist");
    const content = readFileSync(taskCardPath, "utf-8");

    assert.ok(content.includes("/api/tasks/${encodeURIComponent(task.id)}"), "TaskCard must retain generic task cancellation");
    assert.ok(content.includes("/api/bookings/${encodeURIComponent(task.id)}"), "TaskCard must poll and cancel durable bookings");
    assert.ok(content.includes("method: \"POST\""), "TaskCard must send POST request for cancellation");
    assert.ok(content.includes("canCancel"), "TaskCard must guard cancellation for active statuses");
  });

  it("provides the authenticated booking status proxy used by in-app updates", () => {
    const routePath = resolve(frontendDir, "src/app/api/bookings/route.ts");
    const content = readFileSync(routePath, "utf-8");
    assert.ok(content.includes('proxyBackend(req, "/bookings"'), "Recent bookings must use the authenticated backend proxy");
  });
});
