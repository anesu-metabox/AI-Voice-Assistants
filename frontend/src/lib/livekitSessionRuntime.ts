export type LiveKitConnectionStatus =
  | "disconnected"
  | "connecting"
  | "waiting_for_agent"
  | "waiting_for_audio"
  | "connected"
  | "reconnecting"
  | "error";

export type LiveKitLifecycleEvent =
  | "room_connected"
  | "audio_ready"
  | "audio_blocked"
  | "reconnecting"
  | "reconnected"
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
