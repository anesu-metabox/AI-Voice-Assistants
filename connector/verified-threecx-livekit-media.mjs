import { ThreeCxLiveKitMediaBridge } from "./threecx-livekit-media-bridge.mjs";
import {
  createDispatchAgentVerifier,
  resolveDispatchedAgentIdentity,
} from "./livekit-dispatch-verifier.mjs";

/** Resolve exact dispatch ownership before subscribing or publishing call audio. */
export async function startVerifiedThreeCxLiveKitMediaBridge({
  dispatchClient,
  dispatchId,
  roomName,
  expectedAgentName,
  dispatchWaitTimeoutMs,
  dispatchPollIntervalMs,
  controller,
  sessionId,
  onFailureObserver,
  ...bridgeOptions
}) {
  if (!controller || typeof controller.handleMediaFailure !== "function") {
    throw new TypeError("A tenant-bound call controller is required");
  }
  if (typeof sessionId !== "string" || sessionId.length < 1 || sessionId.length > 255) {
    throw new TypeError("A bounded call session ID is required");
  }
  if (onFailureObserver !== undefined && typeof onFailureObserver !== "function") {
    throw new TypeError("onFailureObserver must be a function");
  }
  const participantIdentity = await resolveDispatchedAgentIdentity({
    dispatchClient,
    dispatchId,
    roomName,
    ...(expectedAgentName ? { expectedAgentName } : {}),
    ...(dispatchWaitTimeoutMs ? { timeoutMs: dispatchWaitTimeoutMs } : {}),
    ...(dispatchPollIntervalMs ? { pollIntervalMs: dispatchPollIntervalMs } : {}),
  });
  const onFailure = async ({ reason }) => {
    const outcome = await controller.handleMediaFailure({ sessionId, reason });
    try { onFailureObserver?.({ reason, outcome: outcome?.reason || "unknown" }); } catch { /* Metrics cannot affect call safety. */ }
    if (outcome?.reason !== "call_failed_after_media_fallback") {
      throw new Error("tenant_call_fallback_incomplete");
    }
  };
  const bridge = new ThreeCxLiveKitMediaBridge({
    ...bridgeOptions,
    dispatchId,
    onFailure,
    isAuthorizedAgent: createDispatchAgentVerifier({ dispatchId, participantIdentity }),
  });
  await bridge.start();
  return bridge;
}
