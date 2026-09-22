import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryDir = resolve(frontendDir, "..");

test("3CX setup keeps Service Principal client ID separate from the Route Point DN", () => {
  const app = readFileSync(resolve(frontendDir, "src/App.tsx"), "utf8");
  const api = readFileSync(resolve(repositoryDir, "backend/app/api/integrations.py"), "utf8");
  const broker = readFileSync(resolve(repositoryDir, "backend/credential_broker/main.py"), "utf8");

  assert.match(app, /app_id:\s*appId/);
  assert.match(app, /route_point_dn:\s*routePointDn/);
  assert.match(app, /client_secret:\s*clientSecret/);
  assert.match(app, /3CX Service Principal client ID/);
  assert.match(app, /Programmable Extension \/ Route Point DN/);
  assert.doesNotMatch(app, /Route-point DN \/ Client ID/);
  assert.match(api, /app_id:\s*str\s*=\s*Field/);
  assert.match(api, /route_point_dn:\s*str\s*=\s*Field/);
  assert.match(broker, /_probe_threecx\(request\.pbx_url, request\.app_id, request\.client_secret\)/);
});

test("3CX configuration reloads safe Service Principal metadata without restoring the secret", () => {
  const app = readFileSync(resolve(frontendDir, "src/App.tsx"), "utf8");
  const api = readFileSync(resolve(repositoryDir, "backend/app/api/integrations.py"), "utf8");
  assert.match(app, /setAppId\(data\.appId\s*\|\|\s*""\)/);
  assert.match(app, /setClientSecret\(""\)/);
  assert.match(api, /"appId":\s*row\["app_id"\]/);
  assert.doesNotMatch(api, /"clientSecret"\s*:/);
});

test("3CX setup requires an explicit failure action and limits transfer fallback to approved destinations", () => {
  const app = readFileSync(resolve(frontendDir, "src/App.tsx"), "utf8");
  const api = readFileSync(resolve(repositoryDir, "backend/app/api/integrations.py"), "utf8");
  const broker = readFileSync(resolve(repositoryDir, "backend/credential_broker/main.py"), "utf8");

  assert.match(app, /If the assistant cannot handle a live call/);
  assert.match(app, /Choose an explicit fallback/);
  assert.match(app, /failure_action:\s*failureAction/);
  assert.match(app, /failure_destination:\s*failureAction === "transfer" \? failureDestination : null/);
  assert.match(api, /failure destination must be one of this integration's approved transfer destinations/);
  assert.match(broker, /failure destination must be allowlisted/);
});
