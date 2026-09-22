import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/App.tsx"),
  "utf8",
);

test("onboarding validates a profile before publishing it", () => {
  const flow = source.slice(
    source.indexOf("async function saveAssistant(publish: boolean)"),
    source.indexOf("function IntegrationsPage"),
  );
  const validationIndex = flow.indexOf("/api/assistant-config/validate");
  const saveIndex = flow.indexOf("/api/assistant-config\"");
  assert.notEqual(validationIndex, -1);
  assert.ok(saveIndex > validationIndex, "publish must validate before saving");
  assert.match(flow, /is_deployed: publish/);
  assert.match(flow, /validationResult\?\.status !== "valid"/);
});

test("assistant settings publish instead of silently saving a draft", () => {
  const flow = source.slice(
    source.indexOf("const handleSave = async (deploy = false)"),
    source.indexOf("// ─── Root ─"),
  );
  assert.match(flow, /\/api\/assistant-config\/validate/);
  assert.match(flow, /JSON\.stringify\(\{ \.\.\.config, is_deployed: deploy \}\)/);
  assert.match(flow, /Assistant profile published\. New sessions will use this version\./);
  assert.doesNotMatch(flow, /deployed to production/);
});

test("assistant settings can launch LiveKit against an explicitly saved draft version", () => {
  const settings = source.slice(
    source.indexOf("function AssistantConfigPage"),
    source.indexOf("// ─── Root ─"),
  );
  const sandbox = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/components/sandbox/TestingSandboxPage.tsx"),
    "utf8",
  );
  assert.match(settings, /Save & test draft/);
  assert.match(settings, /profile_version/);
  assert.match(settings, /onTestDraft\(version\)/);
  assert.match(sandbox, /profileVersion !== null\) params\.set\("profile_version"/);
  assert.match(sandbox, /Testing unpublished draft profile version/);
});
