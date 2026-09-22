import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const geminiHook = readFileSync(
  new URL("../src/hooks/useGeminiLiveSession.ts", import.meta.url),
  "utf8",
);
const safeLogger = readFileSync(
  new URL("../src/lib/safeLogging.ts", import.meta.url),
  "utf8",
);

test("voice hook does not log model tool arguments, IDs, or result payloads", () => {
  assert.doesNotMatch(geminiHook, /console\.log\([^\n]*(functionCalls|callId|result|\.ids)/);
  assert.match(geminiHook, /logSafeFailure\("Dormant Gemini voice path failed", error\)/);
});

test("safe logger emits only constrained error type metadata", () => {
  assert.doesNotMatch(safeLogger, /error\.message|String\(error\)|JSON\.stringify\(error\)/);
  assert.match(safeLogger, /errorType/);
});
