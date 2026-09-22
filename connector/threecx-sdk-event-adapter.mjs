import { createHash } from "node:crypto";

const JOIN_EVENT = "routepoint_participant_connected";
const END_EVENT = "routepoint_call_ended";

/**
 * Converts the official 3CX SDK's own-DN participant lifecycle into the
 * controller's small, tenant-bound event contract. The DID/direction resolver
 * is mandatory because CallParticipant does not define a direction field and
 * some PBX configurations omit party_did; ambiguous calls therefore fail
 * closed rather than being guessed or sent to another tenant's assistant.
 */
export class ThreeCxSdkEventAdapter {
  constructor({ client, controller, routePointDn, resolveInboundCall, onSignal = () => {} }) {
    if (!client || typeof client.on !== "function" || typeof client.off !== "function") {
      throw new TypeError("A 3CX CallControlClient is required");
    }
    if (!controller || typeof controller.handleEvent !== "function") {
      throw new TypeError("A 3CX call controller is required");
    }
    if (!routePointDn || typeof routePointDn !== "string") throw new TypeError("routePointDn is required");
    if (typeof resolveInboundCall !== "function") throw new TypeError("A PBX-verified inbound DID resolver is required");
    if (typeof onSignal !== "function") throw new TypeError("onSignal must be a function");

    this.client = client;
    this.controller = controller;
    this.routePointDn = routePointDn;
    this.resolveInboundCall = resolveInboundCall;
    this.onSignal = onSignal;
    this.accepting = false;
    this.participantByCallId = new Map();
    this.callIdByParticipantId = new Map();
    this.started = false;
    this.everConnected = false;
    this.connectionEpoch = 0;
    this.eventQueue = Promise.resolve();

    this.handleConnected = () => {
      const epoch = ++this.connectionEpoch;
      const isFirstConnection = !this.everConnected;
      this.everConnected = true;
      this.#enqueue(async () => {
        if (epoch !== this.connectionEpoch) return;
        if (isFirstConnection) {
          this.accepting = true;
          this.#signal("pbx_connected");
          return;
        }
        await this.#reconcileAfterReconnect();
      });
    };
    this.handleClientDisconnected = () => {
      this.connectionEpoch += 1;
      this.accepting = false;
      this.#signal("pbx_disconnected");
    };
    this.handleClientError = () => this.#signal("pbx_sdk_error");
    this.handleParticipantConnected = (participant) => {
      this.#enqueue(() => this.#onParticipantConnected(participant), "participant_event_failed");
    };
    this.handleParticipantDisconnected = (participantId) => {
      this.#enqueue(() => this.#onParticipantDisconnected(participantId), "participant_end_failed");
    };
    this.handleExtensionParticipantConnected = () => this.#signal("extension_event_ignored");
  }

  /** Register listeners before CallControlClient.connect() to avoid missing initial state. */
  start() {
    if (this.started) return;
    this.started = true;
    this.client.on("connected", this.handleConnected);
    this.client.on("disconnected", this.handleClientDisconnected);
    this.client.on("error", this.handleClientError);
    this.client.on("participantConnected", this.handleParticipantConnected);
    this.client.on("participantDisconnected", this.handleParticipantDisconnected);
    // Extension handles can control calls but have no audio path. Never route them to LiveKit.
    this.client.on("extensionParticipantConnected", this.handleExtensionParticipantConnected);
  }

  /** Stop receiving new events. The owner must close/reconcile active sessions separately. */
  stop() {
    if (!this.started) return;
    this.started = false;
    this.accepting = false;
    this.client.off("connected", this.handleConnected);
    this.client.off("disconnected", this.handleClientDisconnected);
    this.client.off("error", this.handleClientError);
    this.client.off("participantConnected", this.handleParticipantConnected);
    this.client.off("participantDisconnected", this.handleParticipantDisconnected);
    this.client.off("extensionParticipantConnected", this.handleExtensionParticipantConnected);
  }

  /** Drain tenant calls before removing event listeners and closing the PBX connection. */
  async shutdown() {
    const drained = await this.controller.shutdown();
    if (!drained?.stopped) {
      this.#signal("connector_shutdown_incomplete");
      return { stopped: false, calls: drained?.results || [] };
    }
    this.stop();
    try {
      await this.client.disconnect?.();
      this.#signal("connector_shutdown_complete");
      return { stopped: true, calls: drained.results };
    } catch {
      this.#signal("pbx_disconnect_failed");
      return { stopped: false, calls: drained.results };
    }
  }

  getParticipantHandle(participantId) {
    const id = Number(participantId);
    if (!Number.isInteger(id) || id < 1) return undefined;
    const participant = this.client.getParticipantHandle?.(id);
    return participant && !participant.destroyed ? participant : undefined;
  }

  async #onParticipantConnected(participant) {
    if (!this.accepting) return this.#signal("pbx_not_ready");
    if (!participant || participant.isExtensionParticipant !== false || participant.dn !== this.routePointDn) {
      return this.#signal("non_routepoint_participant_ignored");
    }
    const participantId = Number(participant.id);
    const info = participant.info;
    if (!Number.isInteger(participantId) || participantId < 1 || !info || info.status !== "Connected") {
      return this.#signal("invalid_participant_state");
    }

    // participant_uid is the stable, provider-issued call-leg reference. Do
    // not fall back to a caller number, timestamp, or recycled numeric call ID.
    const providerReference = bounded(info.participant_uid, 255);
    if (!providerReference) return this.#signal("stable_call_reference_missing");
    const opaqueKey = createHash("sha256").update(providerReference, "utf8").digest("hex");
    const callId = `pbx-${opaqueKey}`;
    if (this.participantByCallId.has(callId)) return this.#signal("duplicate_local_participant");

    let resolution;
    try {
      resolution = await this.resolveInboundCall({
        routePointDn: this.routePointDn,
        participantDn: bounded(info.dn, 128),
        partyDid: bounded(info.party_did, 64),
        partyDnType: bounded(info.party_dn_type, 64),
        originatedByDn: bounded(info.originated_by_dn, 128),
        originatedByType: bounded(info.originated_by_type, 64),
        status: info.status,
        callId: Number.isInteger(info.callid) ? info.callid : null,
        legId: Number.isInteger(info.legid) ? info.legid : null,
      });
    } catch {
      return this.#signal("inbound_call_unresolved");
    }
    const did = bounded(resolution?.did, 64);
    if (resolution?.direction !== "inbound" || !did) return this.#signal("inbound_call_unresolved");

    this.participantByCallId.set(callId, participantId);
    this.callIdByParticipantId.set(participantId, callId);
    const result = await this.controller.handleEvent({
      type: JOIN_EVENT,
      callId,
      eventId: `join-${opaqueKey}`,
      routePointDn: this.routePointDn,
      did,
      direction: "inbound",
      participantId,
    });
    if (result?.reason !== "call_active") {
      this.participantByCallId.delete(callId);
      this.callIdByParticipantId.delete(participantId);
    }
    this.#signal(result?.reason || "controller_rejected_event");
  }

  async #onParticipantDisconnected(participantId) {
    const id = Number(participantId);
    const callId = this.callIdByParticipantId.get(id);
    if (!Number.isInteger(id) || !callId) return this.#signal("untracked_participant_end");
    const key = callId.slice("pbx-".length);
    const result = await this.controller.handleEvent({
      type: END_EVENT,
      callId,
      eventId: `end-${key}`,
      routePointDn: this.routePointDn,
    });
    if (["call_ended", "already_terminal", "call_not_tracked"].includes(result?.reason)) {
      this.callIdByParticipantId.delete(id);
      this.participantByCallId.delete(callId);
    }
    this.#signal(result?.reason || "controller_rejected_end_event");
  }

  #enqueue(operation, failureReason = "pbx_event_failed") {
    this.eventQueue = this.eventQueue
      .then(operation)
      .catch(() => this.#signal(failureReason));
  }

  /**
   * The SDK reconnects the WebSocket without reloading its REST snapshot. Its
   * `connected` event therefore is not proof that the cached participant set
   * is current. Keep event intake closed until a fresh PBX snapshot has been
   * reconciled against every locally tracked call.
   */
  async #reconcileAfterReconnect() {
    this.accepting = false;
    let snapshot;
    try {
      snapshot = await this.client.getFullInfo();
    } catch {
      return this.#signal("pbx_reconciliation_failed");
    }

    const routePoint = snapshot?.callcontrol?.get?.(this.routePointDn);
    if (!routePoint || !(routePoint.participants instanceof Map)) {
      return this.#signal("pbx_reconciliation_failed");
    }
    const currentById = routePoint.participants;

    for (const [callId, participantId] of this.participantByCallId) {
      const current = currentById.get(String(participantId));
      const providerReference = bounded(current?.participant_uid, 255);
      const currentCallId = providerReference
        ? `pbx-${createHash("sha256").update(providerReference, "utf8").digest("hex")}`
        : null;
      if (current?.status === "Connected" && currentCallId === callId) continue;

      const key = callId.slice("pbx-".length);
      let result;
      try {
        result = await this.controller.handleEvent({
          type: END_EVENT,
          callId,
          eventId: `end-${key}`,
          routePointDn: this.routePointDn,
        });
      } catch {
        return this.#signal("pbx_reconciliation_failed");
      }
      if (!["call_ended", "already_terminal", "call_not_tracked"].includes(result?.reason)) {
        return this.#signal("pbx_reconciliation_failed");
      }
      this.participantByCallId.delete(callId);
      this.callIdByParticipantId.delete(participantId);
    }

    this.accepting = true;
    for (const [id, info] of currentById) {
      if (info?.status !== "Connected") continue;
      const participantId = Number(info.id ?? id);
      if (!Number.isInteger(participantId) || participantId < 1) continue;
      await this.#onParticipantConnected({
        id: participantId,
        dn: this.routePointDn,
        isExtensionParticipant: false,
        info: { ...info, dn: info.dn ?? this.routePointDn },
      });
    }
    this.#signal("pbx_reconciled");
  }

  #signal(reason) {
    try { this.onSignal({ reason }); } catch { /* Observability must not affect call control. */ }
    return { accepted: false, reason };
  }
}

function bounded(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}
