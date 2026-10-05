import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(testDir, "..");

describe("Static Configuration & Native Environment Verification", () => {
  it("verifies package.json declares native WebRTC dependencies and test runner script", () => {
    const pkgPath = resolve(mobileDir, "package.json");
    assert.ok(existsSync(pkgPath), "mobile/package.json must exist");

    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = pkg.dependencies || {};

    assert.ok(deps["@livekit/react-native"], "Must have @livekit/react-native dependency");
    assert.ok(deps["@livekit/react-native-webrtc"], "Must have @livekit/react-native-webrtc dependency");
    assert.ok(deps["@livekit/react-native-expo-plugin"], "Must have @livekit/react-native-expo-plugin dependency");
    assert.ok(deps["@config-plugins/react-native-webrtc"], "Must have @config-plugins/react-native-webrtc dependency");
    assert.ok(pkg.scripts?.test, "Must declare test script in package.json");
  });

  it("verifies app.json contains required plugins for native LiveKit WebRTC", () => {
    const appJsonPath = resolve(mobileDir, "app.json");
    assert.ok(existsSync(appJsonPath), "mobile/app.json must exist");

    const appConfig = JSON.parse(readFileSync(appJsonPath, "utf8"));
    const plugins = appConfig.expo?.plugins || [];

    assert.ok(
      plugins.includes("@livekit/react-native-expo-plugin"),
      "Must include @livekit/react-native-expo-plugin in plugins",
    );
    assert.ok(
      plugins.includes("@config-plugins/react-native-webrtc"),
      "Must include @config-plugins/react-native-webrtc in plugins",
    );
  });

  it("verifies app.json contains Android microphone and audio permissions", () => {
    const appJsonPath = resolve(mobileDir, "app.json");
    const appConfig = JSON.parse(readFileSync(appJsonPath, "utf8"));
    const permissions = appConfig.expo?.android?.permissions || [];

    assert.ok(permissions.includes("RECORD_AUDIO"), "Must request RECORD_AUDIO on Android");
    assert.ok(permissions.includes("MODIFY_AUDIO_SETTINGS"), "Must request MODIFY_AUDIO_SETTINGS on Android");
    assert.ok(permissions.includes("BLUETOOTH"), "Must request BLUETOOTH on Android");
  });

  it("blocks camera permission for the audio-only voice app", () => {
    const appJsonPath = resolve(mobileDir, "app.json");
    const appConfig = JSON.parse(readFileSync(appJsonPath, "utf8"));
    const blockedPermissions = appConfig.expo?.android?.blockedPermissions || [];

    assert.ok(
      blockedPermissions.includes("android.permission.CAMERA"),
      "Audio-only APK must block the camera permission added by WebRTC tooling",
    );
  });

  it("verifies app.json contains iOS microphone usage description and background audio mode", () => {
    const appJsonPath = resolve(mobileDir, "app.json");
    const appConfig = JSON.parse(readFileSync(appJsonPath, "utf8"));
    const iosConfig = appConfig.expo?.ios || {};

    assert.ok(
      iosConfig.infoPlist?.NSMicrophoneUsageDescription,
      "Must provide NSMicrophoneUsageDescription for iOS App Store compliance",
    );
    assert.ok(
      iosConfig.infoPlist?.UIBackgroundModes?.includes("audio"),
      "Must enable UIBackgroundModes: ['audio'] for VoIP call continuation",
    );
  });

  it("verifies app/_layout.tsx registers native WebRTC globals at application root", () => {
    const layoutPath = resolve(mobileDir, "app/_layout.tsx");
    assert.ok(existsSync(layoutPath), "mobile/app/_layout.tsx must exist");

    const content = readFileSync(layoutPath, "utf8");
    assert.match(
      content,
      /import\s+\{\s*(registerLiveKitGlobals\s+as\s+registerGlobals|registerGlobals)\s*\}\s+from\s+['"](\.\.\/src\/services\/livekitNative|@livekit\/react-native)['"]/,
      "Must import registerGlobals at application root",
    );
    assert.match(
      content,
      /registerGlobals\(\)/,
      "Must call registerGlobals() at top-level entry point",
    );
  });
});
