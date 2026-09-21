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
      "src/app/api/company-profile/route.ts",
      "src/app/api/livekit/token/route.ts",
    ]) {
      assert.ok(existsSync(resolve(frontendDir, route)), `${route} must exist`);
    }
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

  it("verifies TaskCard includes cancel action communicating with tasks endpoint", () => {
    const taskCardPath = resolve(frontendDir, "src/components/tasks/TaskCard.tsx");
    assert.ok(existsSync(taskCardPath), "TaskCard component must exist");
    const content = readFileSync(taskCardPath, "utf-8");

    assert.ok(content.includes("fetch(`/api/tasks/"), "TaskCard must invoke /api/tasks/[taskId]");
    assert.ok(content.includes("method: \"POST\""), "TaskCard must send POST request for cancellation");
    assert.ok(content.includes("canCancel"), "TaskCard must guard cancellation for active statuses");
  });
});
