export type LiveKitConnectionStatus =
  | "disconnected"
  | "connecting"
  | "waiting_for_agent"
  | "waiting_for_audio"
  | "connected"
  | "reconnecting"
  | "recovering"
  | "error";

export type LiveKitLifecycleEvent =
  | "room_connected"
  | "audio_ready"
  | "audio_blocked"
  | "reconnecting"
  | "reconnected"
  | "agent_recovering"
  | "agent_ready"
  | "agent_failed"
  | "agent_unavailable"
  | "disconnected"
  | "connection_error";

interface AudioContextLike {
  readonly state: string;
  resume: () => Promise<void>;
}

interface PlayableMediaElement {
  play: () => Promise<void>;
}

export function getLiveKitConnectionStatus(
  event: LiveKitLifecycleEvent,
  hasAssistantAudio = false,
  isAudioPlaybackBlocked = false,
): LiveKitConnectionStatus {
  switch (event) {
    case "room_connected":
    case "agent_unavailable":
      return "waiting_for_agent";
    case "audio_ready":
      return "connected";
    case "audio_blocked":
      return "waiting_for_audio";
    case "reconnecting":
      return "reconnecting";
    case "agent_recovering":
      return "recovering";
    case "agent_ready":
      return isAudioPlaybackBlocked ? "waiting_for_audio" : "connected";
    case "agent_failed":
      return "error";
    case "reconnected":
      if (isAudioPlaybackBlocked) {
        return "waiting_for_audio";
      }
      return hasAssistantAudio ? "connected" : "waiting_for_agent";
    case "disconnected":
      return "disconnected";
    case "connection_error":
      return "error";
  }
}

export const AGENT_HEARTBEAT_TIMEOUT_MS = 15_000;

export type AgentLifecycleState =
  | "starting"
  | "ready"
  | "recovering"
  | "recovered"
  | "failed"
  | "ended";

export interface AgentLifecycleMessage {
  type: "agent_lifecycle" | "agent_heartbeat";
  state: AgentLifecycleState;
  session_id: string;
  sequence: number;
  timestamp: number;
  retryable?: boolean;
  recovery_attempt?: number;
  code?: string;
}

const AGENT_LIFECYCLE_STATES = new Set<AgentLifecycleState>([
  "starting",
  "ready",
  "recovering",
  "recovered",
  "failed",
  "ended",
]);

export function parseAgentLifecycleMessage(value: unknown): AgentLifecycleMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "agent_lifecycle" && candidate.type !== "agent_heartbeat") {
    return null;
  }
  if (
    typeof candidate.state !== "string" ||
    !AGENT_LIFECYCLE_STATES.has(candidate.state as AgentLifecycleState) ||
    typeof candidate.session_id !== "string" ||
    typeof candidate.sequence !== "number" ||
    typeof candidate.timestamp !== "number"
  ) {
    return null;
  }
  return candidate as unknown as AgentLifecycleMessage;
}

export function getAgentLifecycleStatus(
  state: AgentLifecycleState,
  hasAssistantAudio = false,
  isAudioPlaybackBlocked = false,
): LiveKitConnectionStatus {
  switch (state) {
    case "starting":
      return "waiting_for_agent";
    case "recovering":
      return "recovering";
    case "ready":
    case "recovered":
      if (isAudioPlaybackBlocked) return "waiting_for_audio";
      return hasAssistantAudio ? "connected" : "waiting_for_agent";
    case "failed":
      return "error";
    case "ended":
      return "disconnected";
  }
}

export async function activateAudioPlayback(
  context: AudioContextLike,
  mediaElement: PlayableMediaElement,
): Promise<boolean> {
  try {
    if (context.state === "closed") {
      return false;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    if (context.state !== "running") {
      return false;
    }

    await mediaElement.play();
    return true;
  } catch {
    return false;
  }
}

export function createLiveKitRoomName(sessionId: string): string {
  const normalizedId = sessionId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
  if (!normalizedId) {
    throw new Error("A non-empty session ID is required to create a LiveKit room name.");
  }
  return `executive-voice-${normalizedId}`;
}

export function isVoiceSessionActive(status: LiveKitConnectionStatus): boolean {
  return status !== "disconnected" && status !== "error";
}

export function isCurrentSessionGeneration(expected: number, current: number): boolean {
  return expected === current;
}
