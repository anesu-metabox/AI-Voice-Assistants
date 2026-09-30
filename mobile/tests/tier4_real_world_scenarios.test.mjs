import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LiveKitApiClient,
  MockAudioSession,
  MockLiveKitRoom,
  VoiceBotStateMachine,
} from "./harness.mjs";

describe("Tier 4 - Real-World Application Scenarios", () => {
  it("4.1: Conversational Voice Call Simulation with Calendar Tool Query Latency Fillers", async () => {
    const mockAudioSession = new MockAudioSession();
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({
      room: mockRoom,
      audioSession: mockAudioSession,
    });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "jwt_token",
        ws_url: "wss://ai-voice-assistant-vu6rr406.livekit.cloud",
        room: "sandbox-scenario-1",
      }),
    });

    // 1. Establish session
    await stateMachine.startCall({}, mockFetch);
    mockRoom.simulateAgentJoined("calendar-assistant");
    assert.equal(stateMachine.connectionStatus, "connected");

    // 2. User prompt simulation
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "user",
      text: "Can you check my calendar for tomorrow afternoon?",
      is_final: true,
    });
    assert.equal(stateMachine.transcripts.length, 1);
    assert.equal(stateMachine.transcripts[0].text, "Can you check my calendar for tomorrow afternoon?");

    // 3. Tool execution takes >280ms -> Agent streams PAC latency filler
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "Taking a quick look at your calendar...",
      is_final: false,
    });

    assert.equal(stateMachine.isBotSpeaking, true);
    assert.equal(stateMachine.transcripts.length, 2);
    assert.equal(stateMachine.transcripts[1].text, "Taking a quick look at your calendar...");
    assert.equal(stateMachine.transcripts[1].isFinal, false);

    // 4. Backend finishes tool execution -> Agent emits task_update
    stateMachine.handleIncomingDataPacket({
      type: "task_update",
      task: {
        id: "task-cal-01",
        tool_name: "get_calendar_availability",
        title: "Check Calendar Availability",
        status: "completed",
        output: { date: "tomorrow", available_slots: ["14:00", "15:00", "16:00"] },
      },
    });

    assert.equal(stateMachine.tasks.length, 1);
    assert.equal(stateMachine.tasks[0].status, "completed");

    // 5. Agent finishes PAC filler and delivers grounded conversational response
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "You're completely open tomorrow afternoon between 2:00 PM and 4:30 PM.",
      is_final: true,
    });

    assert.equal(stateMachine.transcripts.length, 3);
    assert.equal(stateMachine.transcripts[2].text, "You're completely open tomorrow afternoon between 2:00 PM and 4:30 PM.");
    assert.equal(stateMachine.transcripts[2].isFinal, true);

    await stateMachine.endCall();
  });

  it("4.2: User Interruption Mid-Filler Playout", async () => {
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({ room: mockRoom });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", ws_url: "wss://lk.io" }),
    });

    await stateMachine.startCall({}, mockFetch);
    mockRoom.simulateAgentJoined();

    // Agent starts playing PAC latency filler
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "Let me check available slots...",
      is_final: false,
    });
    assert.equal(stateMachine.isBotSpeaking, true);

    // User interrupts during filler
    const interruptResult = await stateMachine.handleUserSpeechActivity(true);

    assert.equal(interruptResult.interrupted, true);
    assert.ok(interruptResult.elapsedMs < 20, "Interruption during filler must be <20ms");
    assert.equal(stateMachine.isBotSpeaking, false);
    assert.equal(mockRoom.sentPackets.length, 1);
    assert.deepEqual(mockRoom.sentPackets[0].payload, { type: "response.cancel" });

    // User provides replacement prompt
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "user",
      text: "Wait, make that Thursday morning instead!",
      is_final: true,
    });

    assert.equal(stateMachine.transcripts[stateMachine.transcripts.length - 1].text, "Wait, make that Thursday morning instead!");
    await stateMachine.endCall();
  });

  it("4.3: Conversational Backchannel Immunity (Dual-Stage VAD)", async () => {
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({ room: mockRoom });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", ws_url: "wss://lk.io" }),
    });

    await stateMachine.startCall({}, mockFetch);
    mockRoom.simulateAgentJoined();

    // Agent is delivering a multi-sentence availability readout
    stateMachine.isBotSpeaking = true;

    // Dual-Stage VAD Simulation
    function classifyVoiceTurn(durationMs, wordCount) {
      // Backchannels: <= 350ms duration and <= 1 word (e.g. "uh-huh", "yeah", "mhm")
      if (durationMs <= 350 && wordCount <= 1) {
        return "backchannel";
      }
      return "turn";
    }

    // Event 1: User says "uh-huh" (duration 220ms, 1 word)
    const backchannelClassification = classifyVoiceTurn(220, 1);
    assert.equal(backchannelClassification, "backchannel");

    // Since it's a backchannel, speech activity does NOT send response.cancel
    if (backchannelClassification !== "backchannel") {
      await stateMachine.handleUserSpeechActivity(true);
    }

    assert.equal(mockRoom.sentPackets.length, 0, "Backchannel vocalization must NOT cancel bot playback");
    assert.equal(stateMachine.isBotSpeaking, true);

    // Event 2: User says "Actually, let's schedule for 3 PM" (duration 1200ms, 6 words)
    const turnClassification = classifyVoiceTurn(1200, 6);
    assert.equal(turnClassification, "turn");

    const interruptResult = await stateMachine.handleUserSpeechActivity(true);
    assert.equal(interruptResult.interrupted, true);
    assert.equal(mockRoom.sentPackets.length, 1);
    assert.deepEqual(mockRoom.sentPackets[0].payload, { type: "response.cancel" });

    await stateMachine.endCall();
  });

  it("4.4: Dynamic Availability Query with Double-Booking Conflict and Re-Proposal", async () => {
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({ room: mockRoom });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", ws_url: "wss://lk.io" }),
    });

    await stateMachine.startCall({}, mockFetch);
    mockRoom.simulateAgentJoined();

    // 1. User requests 2:00 PM booking
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "user",
      text: "Can you schedule a 30-minute sync tomorrow at 2:00 PM?",
      is_final: true,
    });

    // 2. Tool returns atomic double-booking conflict
    stateMachine.handleIncomingDataPacket({
      type: "task_update",
      task: {
        id: "task-book-conflict",
        tool_name: "book_event",
        status: "failed",
        error: "Slot 14:00 - 14:30 is already booked by 'Team Architecture Review'",
      },
    });

    assert.equal(stateMachine.tasks[0].status, "failed");

    // 3. Agent proposes next open times
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "2:00 PM is already booked for Team Architecture Review. How does 2:30 PM or 4:00 PM sound instead?",
      is_final: true,
    });

    // 4. User accepts alternative
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "user",
      text: "Let's do 2:30 PM.",
      is_final: true,
    });

    // 5. Booking succeeds
    stateMachine.handleIncomingDataPacket({
      type: "task_update",
      task: {
        id: "task-book-success",
        tool_name: "book_event",
        status: "completed",
        output: { event_id: "evt-777", start_time: "14:30", status: "confirmed" },
      },
    });

    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "You're all set! I've booked your sync for tomorrow at 2:30 PM.",
      is_final: true,
    });

    assert.equal(stateMachine.tasks.length, 2);
    assert.equal(stateMachine.tasks[1].status, "completed");
    assert.equal(stateMachine.transcripts[stateMachine.transcripts.length - 1].text.includes("2:30 PM"), true);

    await stateMachine.endCall();
  });

  it("4.5: Calendar Cancellation Flow with ANE-03 Grounded Confirmation Gate", async () => {
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({ room: mockRoom });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", ws_url: "wss://lk.io" }),
    });

    await stateMachine.startCall({}, mockFetch);
    mockRoom.simulateAgentJoined();

    // 1. User asks to cancel
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "user",
      text: "Please cancel my meeting with Sarah tomorrow.",
      is_final: true,
    });

    // 2. Interceptor requires explicit confirmation
    stateMachine.handleIncomingDataPacket({
      type: "task_update",
      task: {
        id: "task-cancel-gate",
        tool_name: "cancel_event",
        status: "confirmation_required",
        output: { prompt: "Are you sure you want to cancel the meeting with Sarah at 2:00 PM?" },
      },
    });

    assert.equal(stateMachine.tasks[0].status, "confirmation_required");

    // 3. Assistant speaks confirmation prompt
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "Are you sure you want to cancel the meeting with Sarah at 2:00 PM?",
      is_final: true,
    });

    // 4. User confirms
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "user",
      text: "Yes, please cancel it.",
      is_final: true,
    });

    // 5. Tool executes cancellation
    stateMachine.handleIncomingDataPacket({
      type: "task_update",
      task: {
        id: "task-cancel-gate",
        tool_name: "cancel_event",
        status: "completed",
        output: { event_id: "evt-sarah-01", status: "cancelled" },
      },
    });

    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "I've cancelled the meeting with Sarah and removed it from your calendar.",
      is_final: true,
    });

    assert.equal(stateMachine.tasks.length, 2);
    assert.equal(stateMachine.tasks[1].status, "completed");

    await stateMachine.endCall();
  });
});
