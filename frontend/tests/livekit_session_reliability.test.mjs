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
const source = readFileSync(runtimePath, "utf8");
const tokenRouteSource = readFileSync(tokenRoutePath, "utf8");
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

test("the token endpoint cannot cache or accept caller-selected session identities", () => {
  assert.match(tokenRouteSource, /export const dynamic = ["']force-dynamic["']/);
  assert.doesNotMatch(tokenRouteSource, /searchParams|get\(["']room["']\)|get\(["']identity["']\)/);
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
