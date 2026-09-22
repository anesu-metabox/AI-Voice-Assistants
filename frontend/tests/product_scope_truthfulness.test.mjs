import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/App.tsx"),
  "utf8",
);
const signInSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/app/sign-in/page.tsx"),
  "utf8",
);

test("signup navigation uses real Neon Auth instead of the legacy fake signup form", () => {
  assert.match(appSource, /case "signup": return <AuthRedirect \/>;/);
  assert.doesNotMatch(appSource, /function SignupPage|function IconMS|Sign up with Microsoft/);
  assert.match(appSource, /window\.location\.assign\("\/sign-in\?mode=sign-up"\)/);
  assert.match(signInSource, /get\("mode"\) === "sign-up"/);
  assert.match(signInSource, /sign-up\/email/);
});

test("first-time accounts go directly to persisted company onboarding, not unsaved demo goals", () => {
  assert.match(appSource, /case "onboarding-goals": return <PersistedCompanyOnboardingPage/);
  assert.match(appSource, /setPage\(companyName \? "dashboard" : "onboarding-goals"\)/);
  assert.doesNotMatch(appSource, /function GoalsPage|function CompanySetupOnboardingPage|function AIConfigOnboardingPage/);
  assert.doesNotMatch(appSource, /Automate Support Lines|In-Call Surveys|Internal Team Ops/);
});

test("shared dashboard header does not imply voice service health without checking it", () => {
  const header = appSource.slice(
    appSource.indexOf("function AppHeader"),
    appSource.indexOf("function AppShell"),
  );
  assert.doesNotMatch(header, /Voice Server Status|#22C55E|Signed-in account/);
});

test("public landing page describes only implemented company and calendar capabilities", () => {
  const landing = appSource.slice(
    appSource.indexOf("function LandingPage"),
    appSource.indexOf("// ─── Onboarding"),
  );
  assert.match(landing, /Google Calendar/);
  assert.match(landing, /availability/);
  assert.doesNotMatch(landing, /CRM|outbound leads|Schedule Enterprise Demo|Start Free Trial/);
  assert.match(landing, /Real session testing/);
  assert.match(landing, /never fabricates call status, audio, transcripts, or tool activity/);
  assert.doesNotMatch(landing, /Live product preview|Inbound Call|Waveform|\[12, 20, 32/);
});

test("phone routing reads company 3CX settings and does not offer mock carrier inventory", () => {
  const phonePage = appSource.slice(
    appSource.indexOf("function PhoneNumbersPage"),
    appSource.indexOf("// ─── Integrations"),
  );
  assert.match(phonePage, /fetch\("\/api\/integrations\/3cx"/);
  assert.match(phonePage, /integration\.dids/);
  assert.match(phonePage, /Live inbound\/outbound calling .*not enabled yet/);
  assert.doesNotMatch(phonePage, /Acquire Voice Lines|Search Available Numbers|\bRent\b|port existing number/i);
});

test("integration security text avoids false hashing and compliance claims", () => {
  const integrations = appSource.slice(
    appSource.indexOf("function IntegrationsPage"),
    appSource.indexOf("// ─── Company Setup"),
  );
  assert.match(integrations, /encrypted before persistence/);
  assert.match(integrations, /no HIPAA or SOC 2 certification is claimed/);
  assert.doesNotMatch(integrations, /securely hashed|strictly conform to HIPAA|SOC2 compliant/i);
});

test("integration page hides Google Contacts controls until the capability is implemented", () => {
  const integrations = appSource.slice(
    appSource.indexOf("function IntegrationsPage"),
    appSource.indexOf("// ─── Company Setup"),
  );
  assert.match(integrations, /GoogleCalendarIntegrationCard/);
  assert.match(integrations, /ThreeCXIntegrationCard/);
  assert.doesNotMatch(integrations, /Google Contacts|Auto-create contacts|Not configured/);
  assert.doesNotMatch(integrations, /<Toggle/);
});

test("Google Calendar integration card contains no inert scheduling controls or phone-call claims", () => {
  const card = appSource.slice(
    appSource.indexOf("function GoogleCalendarIntegrationCard"),
    appSource.indexOf("function ThreeCXIntegrationCard"),
  );
  assert.match(card, /connectedEmail/);
  assert.match(card, /check availability, list events, book meetings, and cancel/);
  assert.doesNotMatch(card, /Auto-Schedule Handlers|custom meeting requests during active phone calls|<Toggle/);
});

test("call history does not imply analytics exist before tenant-scoped records are available", () => {
  const callsPage = appSource.slice(
    appSource.indexOf("function CallsPage"),
    appSource.indexOf("function PhoneNumbersPage"),
  );
  assert.match(callsPage, /Review 3CX session metadata/);
  assert.match(callsPage, /Caller identity, transcripts, and call analytics are not stored or displayed/);
  assert.doesNotMatch(callsPage, /Search calls|Filter Options|sentiment metrics|Operational History Stream/);
  assert.match(callsPage, /Transcript.*Not stored/);
});

test("onboarding does not show a fake active voice sandbox or placeholder transcript", () => {
  const onboarding = appSource.slice(
    appSource.indexOf("function PersistedAssistantOnboardingPage"),
    appSource.indexOf("function IntegrationsPage"),
  );
  assert.doesNotMatch(onboarding, /LiveKit|Voice Testing Sandbox|Transcript|Draft Voice Sandbox|ACTIVE|Waiting for voice output/);
  assert.match(appSource, /case "testing-sandbox": return \(/);
});

test("3CX setup tests and saves credentials in one request then clears the form value", () => {
  const setup = appSource.slice(
    appSource.indexOf("function ThreeCXIntegrationCard"),
    appSource.indexOf("type OnboardingCompanyDraft"),
  );
  assert.match(setup, /method: "PUT"/);
  assert.equal((setup.match(/method: "PUT"/g) || []).length, 1);
  assert.match(setup, /finally \{\s*setClientSecret\(""\)/);
  assert.doesNotMatch(setup, /method: "POST"/);
});

test("configured 3CX integrations can be explicitly confirmed and disconnected", () => {
  const setup = appSource.slice(
    appSource.indexOf("function ThreeCXIntegrationCard"),
    appSource.indexOf("type OnboardingCompanyDraft"),
  );
  assert.match(setup, /const disconnect = async/);
  assert.match(setup, /window\.confirm\(/);
  assert.match(setup, /method: "DELETE"/);
  assert.match(setup, /status\?\.configured && <button[\s\S]*?: "Disconnect"/);
  assert.match(setup, /RECENT_AUTHENTICATION_REQUIRED/);
  assert.match(setup, /setStatus\(\{ configured: false, state: "unconfigured" \}\)/);
});
