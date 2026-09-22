import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const registry = readFileSync(resolve(root, "src/lib/capabilityRegistry.ts"), "utf8");
const policySource = readFileSync(resolve(root, "src/lib/assistantPolicy.json"), "utf8");
const policy = JSON.parse(policySource);

test("onboarding and settings persist only implemented company capabilities", () => {
  assert.match(app, /Enabled company capabilities/);
  assert.match(app, /company_receptionist/);
  assert.match(app, /company_faq/);
  assert.match(app, /google_calendar/);
  assert.match(app, /writeCapabilityFlags\(draft\.capabilities\)/);
  assert.match(app, /writeCapabilityFlags\(capabilities\)/);
  assert.match(app, /Lead qualification and live 3CX call transfer are not available yet/);
});

test("onboarding and assistant settings persist the structured company operating profile", () => {
  const settings = app.slice(app.indexOf("function AssistantConfigPage"), app.indexOf("// ─── Root"));
  for (const field of ["tone", "business_hours", "escalation_rules", "faq_entries"]) {
    assert.match(app, new RegExp(`${field}`));
  }
  assert.match(app, /function CompanyOperatingFields/);
  assert.match(app, /company FAQ capability/);
  assert.match(app, /Guidance only; automated transfer is not available yet/);
  assert.match(settings, /Approved company reference notes/);
  assert.doesNotMatch(settings, /Upload approved company reference material/);
});

test("shared capability policy contains company-scope security and behavior templates", () => {
  assert.equal(policy.version, "company-capability-v2");
  assert.equal(policySource.match(/"systemInstruction"\s*:/g)?.length, 1);
  assert.match(policy.companyPolicyKernel, /capabilities explicitly enabled/);
  assert.match(policy.companyCapabilityInstructions.company_faq, /Do not guess/);
  assert.match(registry, /implemented: false/);
  assert.match(registry, /Capability is not available yet/);
  assert.match(registry, /assistantPolicy\.companyPolicyKernel/);
});
