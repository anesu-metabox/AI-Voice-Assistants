import test from "node:test";
import assert from "node:assert/strict";
import { JobStatus } from "@livekit/protocol";
import { ParticipantKind } from "@livekit/rtc-node";
import {
  createDispatchAgentVerifier,
  resolveDispatchedAgentIdentity,
} from "../livekit-dispatch-verifier.mjs";

const request = { dispatchId: "dispatch-opaque", roomName: "threecx-0123456789abcdef0123456789abcdef" };

test("resolves only the participant identity reported by the exact running dispatch", async () => {
  let now = 1000;
  let requests = 0;
  const identity = await resolveDispatchedAgentIdentity({
    ...request,
    timeoutMs: 100,
    pollIntervalMs: 10,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    dispatchClient: {
      async getDispatch(dispatchId, roomName) {
        requests += 1;
        assert.equal(dispatchId, request.dispatchId);
        assert.equal(roomName, request.roomName);
        if (requests === 1) return undefined;
        if (requests === 2) return { id: dispatchId, room: roomName, agentName: "calendar-assistant", state: { jobs: [] } };
        return {
          id: dispatchId,
          room: roomName,
          agentName: "calendar-assistant",
          state: { jobs: [{ dispatchId, agentName: "calendar-assistant", state: { status: JobStatus.JS_RUNNING, participantIdentity: "agent-job-opaque" } }] },
        };
      },
    },
  });
  assert.equal(identity, "agent-job-opaque");
  assert.equal(requests, 3);
});

test("rejects dispatch and job binding mismatches, ambiguous jobs, and completed jobs", async (t) => {
  const mismatches = [
    [{ id: "other", room: request.roomName, agentName: "calendar-assistant" }, /binding_mismatch/],
    [{ id: request.dispatchId, room: "other-room", agentName: "calendar-assistant" }, /binding_mismatch/],
    [{ id: request.dispatchId, room: request.roomName, agentName: "other-agent" }, /binding_mismatch/],
    [{ id: request.dispatchId, room: request.roomName, agentName: "calendar-assistant", state: { jobs: [{}, {}] } }, /ambiguous/],
    [{ id: request.dispatchId, room: request.roomName, agentName: "calendar-assistant", state: { jobs: [{ state: { status: JobStatus.JS_FAILED } }] } }, /not_running/],
  ];
  for (const [dispatch, error] of mismatches) {
    await t.test(error.source, async () => {
      await assert.rejects(resolveDispatchedAgentIdentity({
        ...request,
        timeoutMs: 1,
        pollIntervalMs: 1,
        dispatchClient: { getDispatch: async () => dispatch },
      }), error);
    });
  }
});

test("verifies exact participant identity, dispatch ID, and LiveKit AGENT kind", () => {
  const verify = createDispatchAgentVerifier({ dispatchId: "dispatch-opaque", participantIdentity: "agent-job-opaque" });
  assert.equal(verify({ identity: "agent-job-opaque", kind: ParticipantKind.AGENT }, "dispatch-opaque"), true);
  assert.equal(verify({ identity: "agent-job-opaque", kind: ParticipantKind.STANDARD }, "dispatch-opaque"), false);
  assert.equal(verify({ identity: "other-agent", kind: ParticipantKind.AGENT }, "dispatch-opaque"), false);
  assert.equal(verify({ identity: "agent-job-opaque", kind: ParticipantKind.AGENT }, "other-dispatch"), false);
});
