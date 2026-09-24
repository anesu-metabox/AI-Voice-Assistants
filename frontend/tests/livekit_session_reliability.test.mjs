import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const testDir = dirname(fileURLToPath(import.meta.url));
const runtimePath = resolve(testDir, "../src/lib/livekitSessionRuntime.ts");
const tokenRoutePath = resolve(testDir, "../src/app/api/livekit-token/route.ts");
const activeTokenRoutePath = resolve(testDir, "../src/app/api/livekit/token/route.ts");
const devLauncherPath = resolve(testDir, "../../scripts/dev.ps1");
const configPreflightPath = resolve(testDir, "../../scripts/check-config.ps1");
const source = readFileSync(runtimePath, "utf8");
const tokenRouteSource = readFileSync(tokenRoutePath, "utf8");
const activeTokenRouteSource = readFileSync(activeTokenRoutePath, "utf8");
const devLauncherSource = readFileSync(devLauncherPath, "utf8");
const configPreflightSource = readFileSync(configPreflightPath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const runtimeModule = { exports: {} };
new Function("module", "exports", compiled)(runtimeModule, runtimeModule.exports);

const {
  activateAudioPlayback,
  createLiveKitRoomName,
  getLiveKitConnectionStatus,
  isCurrentSessionGeneration,
  isVoiceSessionActive,
} = runtimeModule.exports;

describe("LiveKit connection reliability state machine", () => {
  it("does not report connected until assistant audio is ready", () => {
    assert.equal(getLiveKitConnectionStatus("room_connected"), "waiting_for_agent");
    assert.equal(getLiveKitConnectionStatus("audio_ready", true), "connected");
  });

  it("represents reconnecting and restores the correct readiness state", () => {
    assert.equal(getLiveKitConnectionStatus("reconnecting", true), "reconnecting");
    assert.equal(getLiveKitConnectionStatus("reconnected", false), "waiting_for_agent");
    assert.equal(getLiveKitConnectionStatus("reconnected", true), "connected");
    assert.equal(getLiveKitConnectionStatus("reconnected", true, true), "waiting_for_audio");
  });

  it("distinguishes a connected agent from blocked browser audio", () => {
    assert.equal(getLiveKitConnectionStatus("audio_blocked", true), "waiting_for_audio");
    assert.equal(getLiveKitConnectionStatus("audio_ready", true), "connected");
  });
});

describe("LiveKit assistant audio activation", () => {
  it("resumes a suspended AudioContext before starting playback", async () => {
    const calls = [];
    const context = {
      state: "suspended",
      async resume() {
        calls.push("resume");
        this.state = "running";
      },
    };
    const mediaElement = {
      async play() {
        calls.push("play");
      },
    };

    assert.equal(await activateAudioPlayback(context, mediaElement), true);
    assert.deepEqual(calls, ["resume", "play"]);
  });

  it("returns a recoverable failure when browser autoplay blocks playback", async () => {
    const context = { state: "running", async resume() {} };
    const mediaElement = {
      async play() {
        throw new Error("NotAllowedError");
      },
    };

    assert.equal(await activateAudioPlayback(context, mediaElement), false);
  });

  it("can recover on a later user gesture after the first play attempt fails", async () => {
    let attempts = 0;
    const context = { state: "running", async resume() {} };
    const mediaElement = {
      async play() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("NotAllowedError");
        }
      },
    };

    assert.equal(await activateAudioPlayback(context, mediaElement), false);
    assert.equal(await activateAudioPlayback(context, mediaElement), true);
    assert.equal(attempts, 2);
  });
});

test("closed AudioContexts fail without attempting media playback", async () => {
  let playCalls = 0;
  const context = { state: "closed", async resume() {} };
  const mediaElement = {
    async play() {
      playCalls += 1;
    },
  };

  assert.equal(await activateAudioPlayback(context, mediaElement), false);
  assert.equal(playCalls, 0);
});

test("each voice session can be isolated in its own deterministic LiveKit room", () => {
  const first = createLiveKitRoomName("A1111111-1111-1111-1111-111111111111");
  const second = createLiveKitRoomName("B2222222-2222-2222-2222-222222222222");

  assert.equal(first, "executive-voice-a1111111-1111-1111-1111-111111111111");
  assert.notEqual(first, second);
});

test("the legacy unauthenticated token endpoint is disabled", () => {
  assert.match(tokenRouteSource, /export const dynamic = ["']force-dynamic["']/);
  assert.match(tokenRouteSource, /LEGACY_VOICE_PATH_DISABLED/);
  assert.match(tokenRouteSource, /status:\s*410/);
  assert.doesNotMatch(tokenRouteSource, /AccessToken|LIVEKIT_API_SECRET|toJwt/);
});

test("the authenticated backend token proxy remains the active LiveKit route", () => {
  assert.match(activeTokenRouteSource, /proxyBackend\(request, ["']\/livekit\/token["']/);
  assert.doesNotMatch(activeTokenRouteSource, /AccessToken|LIVEKIT_API_SECRET|toJwt/);
});

test("the local launcher scopes LiveKit signing credentials to FastAPI", () => {
  assert.match(devLauncherSource, /LIVEKIT_API_KEY\s*=\s*\$liveKitApiKey/);
  assert.match(devLauncherSource, /LIVEKIT_API_SECRET\s*=\s*\$liveKitApiSecret/);
  assert.match(devLauncherSource, /LIVEKIT_URL\s*=\s*\$liveKitUrl/);
  assert.match(devLauncherSource, /CREDENTIAL_BROKER_SHARED_SECRET\s*=\s*\$null/);
  assert.doesNotMatch(
    devLauncherSource,
    /\$env:CREDENTIAL_BROKER_SHARED_SECRET\s*=\s*\$(?!null\b)/,
  );

  const agentMatch = devLauncherSource.search(/\$agent\s*=\s*Start-(?:Service)?Process/);
  const agentStart = agentMatch !== -1 ? agentMatch : devLauncherSource.indexOf("$agent = Start-Process");
  const agentEnd = devLauncherSource.indexOf("$processes += $agent", agentStart);
  const agentEnvironment = devLauncherSource.slice(agentStart, agentEnd);
  assert.match(agentEnvironment, /LIVEKIT_API_KEY\s*=\s*\$liveKitApiKey/);
  assert.match(agentEnvironment, /LIVEKIT_API_SECRET\s*=\s*\$liveKitApiSecret/);
  assert.match(agentEnvironment, /GOOGLE_API_KEY\s*=\s*\$googleApiKey/);
  assert.match(agentEnvironment, /LIVEKIT_SESSION_CONTEXT_SECRET\s*=\s*\$sessionContextSecret/);
  assert.match(agentEnvironment, /CREDENTIAL_BROKER_SHARED_SECRET\s*=\s*\$null/);
  assert.match(agentEnvironment, /DATABASE_URL_UNPOOLED\s*=\s*\$null/);
  assert.match(devLauncherSource, /TRIGGER_API_KEY\s*=\s*\$null/);
  assert.match(configPreflightSource, /"LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TRIGGER_API_KEY"/);
  assert.match(devLauncherSource, /LIVEKIT_SESSION_CONTEXT_SECRET\s*=\s*\$sessionContextSecret/);
});

test("engine switches tear down every in-progress voice session state", () => {
  for (const status of [
    "connecting",
    "waiting_for_agent",
    "waiting_for_audio",
    "connected",
    "reconnecting",
  ]) {
    assert.equal(isVoiceSessionActive(status), true, `${status} must be disconnected`);
  }

  assert.equal(isVoiceSessionActive("disconnected"), false);
  assert.equal(isVoiceSessionActive("error"), false);
});

test("late callbacks from an invalidated connection generation are rejected", () => {
  assert.equal(isCurrentSessionGeneration(4, 4), true);
  assert.equal(isCurrentSessionGeneration(3, 4), false);
});

test("each remote audio subscription owns a fresh media element", () => {
  const source = readFileSync(
    resolve(testDir, "../src/hooks/useLiveKitSession.ts"),
    "utf-8",
  );
  assert.match(source, /document\.createElement\(["']audio["']\)/);
  assert.match(source, /track\.attach\(audioElement\)/);
  assert.match(source, /assistantTrackRef\.current\?\.detach\(previousAudioElement\)/);
  assert.match(source, /previousAudioElement\.srcObject = null/);
});

test("the active sandbox accepts only one LiveKit assistant audio source", () => {
  const source = readFileSync(
    resolve(testDir, "../src/components/sandbox/TestingSandboxPage.tsx"),
    "utf-8",
  );
  assert.match(source, /assistantParticipantIdentityRef/);
  assert.match(source, /acceptedIdentity !== participant\.identity/);
  assert.match(source, /assistantAudioTrackRef\.current === track/);
  assert.match(source, /cleanupAssistantAudio\(\)/);
});

test("browser-direct Gemini voice is disabled", () => {
  const source = readFileSync(
    resolve(testDir, "../src/app/api/gemini-token/route.ts"),
    "utf-8",
  );
  assert.match(source, /DIRECT_VOICE_DISABLED/);
  assert.match(source, /status:\s*410/);
  assert.doesNotMatch(source, /authTokens\.create|ai\.live\.connect/);
});

test("only one browser tab can own a LiveKit voice session", () => {
  const source = readFileSync(
    resolve(testDir, "../src/components/sandbox/TestingSandboxPage.tsx"),
    "utf-8",
  );
  assert.match(source, /navigator\.locks\.request/);
  assert.match(source, /vocalist-livekit-voice-session/);
  assert.match(source, /ifAvailable:\s*true/);
  assert.match(source, /already active in another browser tab/);
  assert.match(source, /releaseVoiceSessionLock\(\)/);
});
