import { randomUUID } from "node:crypto";

const ROUTE_POINT_JOIN = "routepoint_participant_connected";
const ROUTE_POINT_END = "routepoint_call_ended";
const MEDIA_FAILURE_REASONS = new Set([
  "agent_audio_stream_failed",
  "agent_audio_unsubscribed",
  "verified_agent_disconnected",
  "livekit_room_disconnected",
  "pbx_audio_stream_ended",
  "pbx_audio_stream_failed",
  "pbx_audio_queue_overflow",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Coordinates one tenant-bound inbound call after the authenticated 3CX SDK
 * adapter normalizes its event. It intentionally knows nothing about SDK
 * credentials, HTTP, Neon connections, or LiveKit signing keys: those are
 * provided by isolated workload adapters.
 */
export class ThreeCxCallController {
  constructor({
    tenantBinding,
    claimCall,
    transitionCall,
    renewCallLease,
    dispatchAgent,
    attachMedia,
    stopAgent,
    handlePbxFallback,
    onDecision = () => {},
    leaseRenewIntervalMs = 15000,
  }) {
    if (!tenantBinding || !UUID_RE.test(tenantBinding.companyId || "")) {
      throw new TypeError("A verified tenant binding is required");
    }
    const authSubject = boundedString(tenantBinding.authSubject, 255)?.trim() || null;
    if (!authSubject) {
      throw new TypeError("A verified auth subject is required");
    }
    const timezone = boundedString(tenantBinding.timezone, 128)?.trim() || null;
    if (!timezone || !isIanaTimezone(timezone)) {
      throw new TypeError("A valid tenant timezone is required");
    }
    if (!Number.isInteger(tenantBinding.profileVersion) || tenantBinding.profileVersion < 1) {
      throw new TypeError("A published profile version is required");
    }
    const integrationId = boundedString(tenantBinding.integrationId, 255)?.trim() || null;
    const routePointDn = boundedString(tenantBinding.routePointDn, 128)?.trim() || null;
    if (!integrationId || !routePointDn || !Array.isArray(tenantBinding.dids)) {
      throw new TypeError("A tenant-bound active integration is required");
    }
    const transferDestinations = Array.isArray(tenantBinding.transferDestinations)
      ? tenantBinding.transferDestinations
        .map((value) => boundedString(value, 128)?.trim())
        .filter(Boolean)
      : null;
    const dids = tenantBinding.dids
      .map((value) => boundedString(value, 64)?.trim())
      .filter(Boolean);
    if (dids.length === 0) throw new TypeError("At least one tenant-bound inbound DID is required");
    const failureAction = tenantBinding.failureAction;
    const failureDestination = boundedString(tenantBinding.failureDestination, 128)?.trim() || null;
    if (!transferDestinations || !["disconnect", "transfer"].includes(failureAction)) {
      throw new TypeError("An explicit tenant 3CX failure policy is required");
    }
    if (failureAction === "disconnect" && tenantBinding.failureDestination != null) {
      throw new TypeError("Disconnect failure policy cannot include a destination");
    }
    if (failureAction === "transfer"
      && (!failureDestination || !transferDestinations.includes(failureDestination))) {
      throw new TypeError("Transfer failure destination must be allowlisted for this tenant");
    }
    for (const [name, fn] of Object.entries({ claimCall, transitionCall, renewCallLease, dispatchAgent, attachMedia, stopAgent, handlePbxFallback, onDecision })) {
      if (typeof fn !== "function") throw new TypeError(`${name} must be a function`);
    }
    if (!Number.isInteger(leaseRenewIntervalMs) || leaseRenewIntervalMs < 100 || leaseRenewIntervalMs > 300000) {
      throw new RangeError("leaseRenewIntervalMs must be between 100 and 300000 milliseconds");
    }

    this.binding = Object.freeze({
      companyId: tenantBinding.companyId,
      authSubject,
      timezone,
      profileVersion: tenantBinding.profileVersion,
      integrationId,
      routePointDn,
      dids: Object.freeze(dids),
      transferDestinations: Object.freeze(transferDestinations),
      failureAction,
      failureDestination,
    });
    this.claimCall = claimCall;
    this.transitionCall = transitionCall;
    this.renewCallLease = renewCallLease;
    this.dispatchAgent = dispatchAgent;
    this.attachMedia = attachMedia;
    this.stopAgent = stopAgent;
    this.handlePbxFallback = handlePbxFallback;
    this.onDecision = onDecision;
    this.leaseRenewIntervalMs = leaseRenewIntervalMs;
    this.calls = new Map();
    this.inflightJoins = new Set();
    this.stopping = false;
  }

  /** Accept only call-control events emitted by the bound route-point adapter. */
  async handleEvent(event) {
    if (!event || typeof event !== "object") return this.#decision("invalid_event");
    if (event.type === ROUTE_POINT_END) return this.#endCall(event);
    if (this.stopping) return this.#decision("controller_stopping");
    const task = this.#handleJoinEvent(event);
    this.inflightJoins.add(task);
    try {
      return await task;
    } finally {
      this.inflightJoins.delete(task);
    }
  }

  async #handleJoinEvent(event) {
    if (event.type !== ROUTE_POINT_JOIN) return this.#decision("unsupported_event");

    const callId = boundedString(event.callId, 255);
    const eventId = boundedString(event.eventId, 255);
    const did = boundedString(event.did, 64);
    if (!callId || !eventId || !did || !Number.isInteger(event.participantId) || event.participantId < 1
      || event.routePointDn !== this.binding.routePointDn) {
      return this.#decision("invalid_route_point_event");
    }
    if (event.direction !== "inbound") return this.#decision("unsupported_direction");
    if (!this.binding.dids.includes(did)) return this.#decision("unconfigured_did");

    // The DB inbox and unique (company_id, pbx_call_id) constraint are the
    // cross-process deduplication authority. Never dispatch on a non-claim.
    let claim;
    try {
      claim = await this.claimCall({
        companyId: this.binding.companyId,
        integrationId: this.binding.integrationId,
        pbxCallId: callId,
        eventId,
        eventType: event.type,
        did,
        direction: "inbound",
      });
    } catch {
      return this.#decision("claim_failed");
    }
    if (!claim?.claimed) return this.#decision(claim?.reason === "duplicate_event" ? "duplicate_event" : "call_not_claimed");

    const row = claim.call || {};
    const claimToken = boundedString(row.claim_token, 128);
    const roomName = boundedString(row.livekit_room, 128);
    if (!claimToken || !/^threecx-[0-9a-f]{32}$/i.test(roomName || "")) {
      await this.#bestEffortFailure(callId, claimToken, "claimed_call_invalid");
      return this.#decision("claimed_call_invalid");
    }

    const entry = {
      callId,
      claimToken,
      roomName,
      participantId: event.participantId,
      state: "claimed",
      sessionId: randomUUID(),
      dispatchId: null,
      closeMedia: null,
      lock: Promise.resolve(),
      leaseTimer: null,
      consecutiveRenewFailures: 0,
      leaseLost: false,
    };
    this.calls.set(callId, entry);
    return this.#serialize(entry, () => this.#startCall(entry));
  }

  /** Route a trusted media bridge's static failure code through call ownership and cleanup. */
  async handleMediaFailure({ sessionId, reason } = {}) {
    if (!boundedString(sessionId, 255) || !MEDIA_FAILURE_REASONS.has(reason)) {
      return this.#decision("invalid_media_failure");
    }
    const entry = [...this.calls.values()].find((call) => call.sessionId === sessionId);
    if (!entry) return this.#decision("media_failure_call_not_tracked");

    return this.#serialize(entry, async () => {
      this.#clearLeaseRenewal(entry);
      if (["ended", "failed"].includes(entry.state)) return this.#decision("media_failure_call_terminal");
      if (entry.state !== "ending" && !(await this.#transition(entry, "ending"))) {
        return this.#decision("media_failure_state_update_failed");
      }
      if (!(await this.#cleanup(entry))) return this.#decision("media_failure_cleanup_incomplete");

      let fallbackComplete = false;
      try {
        fallbackComplete = await this.handlePbxFallback(this.#fallbackRequest(entry, reason)) === true;
      } catch { /* PBX fallback errors never escape diagnostics. */ }
      if (!fallbackComplete) return this.#decision("media_failure_fallback_incomplete");
      if (!(await this.#transition(entry, "failed"))) {
        return this.#decision("media_failure_state_update_failed");
      }
      this.calls.delete(entry.callId);
      return this.#decision("call_failed_after_media_fallback");
    });
  }

  /**
   * Stop accepting new calls and drain active claims before process shutdown.
   * The configured PBX fallback must actually transfer/drop the caller; merely
   * stopping local media is not considered successful cleanup.
   */
  async shutdown() {
    this.stopping = true;
    await Promise.allSettled([...this.inflightJoins]);
    const results = [];
    for (const entry of [...this.calls.values()]) {
      results.push(await this.#serialize(entry, async () => {
        this.#clearLeaseRenewal(entry);
        if (["ended", "failed"].includes(entry.state)) {
          this.calls.delete(entry.callId);
          return this.#decision("already_terminal");
        }
        const priorState = entry.state;
        if (priorState !== "claimed" && priorState !== "ending") {
          if (!(await this.#transition(entry, "ending"))) return this.#decision("shutdown_transition_lost");
        }
        if (!(await this.#cleanup(entry))) return this.#decision("shutdown_cleanup_incomplete");
        let fallbackComplete = false;
        try {
          fallbackComplete = await this.handlePbxFallback(this.#fallbackRequest(entry, "connector_shutdown")) === true;
        } catch { /* PBX errors never escape diagnostics. */ }
        if (!fallbackComplete) return this.#decision("shutdown_fallback_incomplete");
        if (!(await this.#transition(entry, "ended"))) return this.#decision("shutdown_state_update_failed");
        this.calls.delete(entry.callId);
        return this.#decision("call_ended_for_shutdown");
      }));
    }
    return { stopped: this.calls.size === 0, results };
  }

  async #startCall(entry) {
    let stage = "claim";
    try {
      if (!(await this.#transition(entry, "connecting"))) {
        await this.#cleanup(entry);
        this.calls.delete(entry.callId);
        return this.#decision("claim_transition_lost");
      }
      stage = "dispatch";
      // This object is input to the trusted dispatcher, which must sign it
      // with the same issuer/audience/expiry checks as browser-created jobs.
      // PBX call IDs, DIDs, caller data, and SDK payloads are not model context.
      const dispatch = await this.dispatchAgent({
        companyId: this.binding.companyId,
        authSubject: this.binding.authSubject,
        timezone: this.binding.timezone,
        profileVersion: this.binding.profileVersion,
        integrationId: this.binding.integrationId,
        sessionId: entry.sessionId,
        roomName: entry.roomName,
        userIdentity: `threecx-${entry.sessionId}`,
      });
      entry.dispatchId = boundedString(dispatch?.dispatchId, 255);
      if (!entry.dispatchId) throw new Error("dispatch_not_created");

      stage = "media";
      const media = await this.attachMedia({
        sessionId: entry.sessionId,
        roomName: entry.roomName,
        dispatchId: entry.dispatchId,
        pbxParticipantId: entry.participantId,
      });
      if (!media || typeof media.close !== "function") throw new Error("media_bridge_not_ready");
      entry.closeMedia = media.close;

      stage = "activation";
      if (!(await this.#transition(entry, "active", entry.dispatchId))) {
        throw new Error("active_transition_lost");
      }
      this.#scheduleLeaseRenewal(entry);
      return this.#decision("call_active");
    } catch (error) {
      const cleanupComplete = await this.#cleanup(entry);
      const failureReason = classifyFailure(stage, error);
      let endingRecorded = false;
      let fallbackComplete = false;
      let failureRecorded = false;
      if (cleanupComplete) {
        // Persist the non-terminal state before touching the PBX. If ownership
        // was lost, this worker must not transfer or disconnect another
        // worker's call. A failed fallback remains recoverable as "ending".
        try { endingRecorded = await this.#transition(entry, "ending"); } catch { /* Reconcile the durable claim. */ }
        if (endingRecorded) {
          try {
            fallbackComplete = await this.handlePbxFallback(this.#fallbackRequest(entry, failureReason)) === true;
          } catch { /* PBX fallback errors are never forwarded or logged. */ }
          if (fallbackComplete) {
            try { failureRecorded = await this.#transition(entry, "failed"); } catch { /* Reconcile the durable claim. */ }
          }
        }
      } else {
        // Keep the durable record recoverable while resources may still be
        // live. An ending call can retry idempotent cleanup on a later event.
        try { await this.#transition(entry, "ending"); } catch { /* Keep the entry for reconciliation. */ }
      }
      if (failureRecorded) this.calls.delete(entry.callId);
      // Do not forward exception text: provider errors may contain credentials,
      // caller IDs, URLs, or raw SDK event values.
      return this.#decision(!cleanupComplete
        ? "cleanup_incomplete"
        : !endingRecorded
          ? "state_update_failed"
        : !fallbackComplete
          ? "failure_fallback_incomplete"
          : failureRecorded
            ? failureReason
            : "state_update_failed");
    }
  }

  async #endCall(event) {
    const callId = boundedString(event.callId, 255);
    const eventId = boundedString(event.eventId, 255);
    if (!callId || !eventId || event.routePointDn !== this.binding.routePointDn) {
      return this.#decision("invalid_end_event");
    }
    const entry = this.calls.get(callId);
    if (!entry) return this.#decision("call_not_tracked");
    return this.#serialize(entry, async () => {
      try {
        this.#clearLeaseRenewal(entry);
        if (["ended", "failed"].includes(entry.state)) return this.#decision("already_terminal");
        if (entry.state === "claimed") {
          if (!(await this.#transition(entry, "ended"))) return this.#decision("end_transition_lost");
        } else {
          if (entry.state !== "ending" && !(await this.#transition(entry, "ending"))) {
            return this.#decision("end_transition_lost");
          }
          if (!(await this.#cleanup(entry))) return this.#decision("cleanup_incomplete");
          if (!(await this.#transition(entry, "ended"))) return this.#decision("end_transition_lost");
        }
        this.calls.delete(callId);
        return this.#decision("call_ended");
      } catch {
        return this.#decision("end_transition_failed");
      }
    });
  }

  async #transition(entry, newState, dispatchId) {
    const expectedState = entry.state;
    const updated = await this.transitionCall({
      companyId: this.binding.companyId,
      pbxCallId: entry.callId,
      claimToken: entry.claimToken,
      expectedState,
      newState,
      ...(dispatchId ? { livekitDispatchId: dispatchId } : {}),
    });
    if (updated) entry.state = newState;
    return updated;
  }

  #scheduleLeaseRenewal(entry) {
    if (entry.state !== "active" || entry.leaseTimer || entry.leaseLost) return;
    entry.leaseTimer = setTimeout(() => {
      entry.leaseTimer = null;
      void this.#serialize(entry, () => this.#renewLease(entry))
        .catch(() => this.#decision("lease_renewal_failed"))
        .finally(() => this.#scheduleLeaseRenewal(entry));
    }, this.leaseRenewIntervalMs);
    entry.leaseTimer.unref?.();
  }

  #clearLeaseRenewal(entry) {
    if (entry.leaseTimer) clearTimeout(entry.leaseTimer);
    entry.leaseTimer = null;
  }

  async #renewLease(entry) {
    if (entry.state !== "active") return this.#decision("lease_renewal_skipped");
    let renewed = false;
    try {
      renewed = await this.renewCallLease({
        companyId: this.binding.companyId,
        integrationId: this.binding.integrationId,
        pbxCallId: entry.callId,
        claimToken: entry.claimToken,
        sessionId: entry.sessionId,
      });
    } catch {
      entry.consecutiveRenewFailures += 1;
      if (entry.consecutiveRenewFailures < 2) return this.#decision("lease_renewal_retry");
    }
    if (renewed) {
      entry.consecutiveRenewFailures = 0;
      return this.#decision("lease_renewed");
    }

    entry.leaseLost = true;
    this.#clearLeaseRenewal(entry);
    const transitioned = await this.#transition(entry, "ending");
    const cleanupComplete = await this.#cleanup(entry);
    if (!cleanupComplete) return this.#decision("lease_lost_cleanup_incomplete");
    let fallbackComplete = false;
    try {
      fallbackComplete = await this.handlePbxFallback(
        this.#fallbackRequest(entry, "call_claim_lease_lost"),
      ) === true;
    } catch { /* PBX fallback errors are never logged or forwarded. */ }
    if (!fallbackComplete) return this.#decision("lease_lost_fallback_incomplete");
    if (!transitioned) return this.#decision("lease_lost_state_update_failed");
    if (transitioned && !(await this.#transition(entry, "ended"))) {
      return this.#decision("lease_lost_state_update_failed");
    }
    this.calls.delete(entry.callId);
    return this.#decision("call_ended_after_lease_loss");
  }

  async #cleanup(entry) {
    this.#clearLeaseRenewal(entry);
    let clean = true;
    if (entry.closeMedia) {
      try {
        await entry.closeMedia();
        entry.closeMedia = null;
      } catch { clean = false; }
    }
    if (entry.dispatchId) {
      try {
        await this.stopAgent({
          companyId: this.binding.companyId,
          integrationId: this.binding.integrationId,
          sessionId: entry.sessionId,
          roomName: entry.roomName,
          dispatchId: entry.dispatchId,
        });
        entry.dispatchId = null;
      } catch { clean = false; }
    }
    return clean;
  }

  #fallbackRequest(entry, reason) {
    return {
      companyId: this.binding.companyId,
      integrationId: this.binding.integrationId,
      pbxParticipantId: entry.participantId,
      sessionId: entry.sessionId,
      reason,
      failureAction: this.binding.failureAction,
      ...(this.binding.failureAction === "transfer"
        ? { failureDestination: this.binding.failureDestination }
        : {}),
    };
  }

  async #bestEffortFailure(callId, claimToken, reason) {
    if (!claimToken) return;
    try {
      await this.transitionCall({
        companyId: this.binding.companyId,
        pbxCallId: callId,
        claimToken,
        expectedState: "claimed",
        newState: "failed",
      });
    } catch {
      this.#decision(reason);
    }
  }

  #serialize(entry, operation) {
    const result = entry.lock.then(operation, operation);
    entry.lock = result.catch(() => {});
    return result;
  }

  #decision(reason) {
    try { this.onDecision({ reason }); } catch { /* Metrics cannot affect call safety. */ }
    return { accepted: reason === "call_active", reason };
  }
}

function boundedString(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function isIanaTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function classifyFailure(stage, error) {
  if (stage === "claim") return "claim_transition_failed";
  if (stage === "media") return "media_bridge_failed";
  if (stage === "activation" && error?.message === "active_transition_lost") return "active_transition_lost";
  if (stage === "dispatch") return "dispatch_failed";
  return "call_start_failed";
}
