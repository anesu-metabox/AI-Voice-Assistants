import type { VoiceBotTask, VoiceBotTranscript } from '../types/voiceBot';

export type ParsedVoicePacket =
  | { type: 'transcript'; transcript: VoiceBotTranscript }
  | { type: 'task_update'; task: VoiceBotTask }
  | null;

/** Normalize production LiveKit data-channel packets before they touch React state. */
export function parseVoicePacket(
  payload: Uint8Array,
  now = Date.now(),
  createId: () => string = () => `msg-${now}-${Math.random()}`,
): ParsedVoicePacket {
  try {
    const packet = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    if (packet.type === 'transcript' && typeof packet.text === 'string' && packet.text.trim()) {
      return {
        type: 'transcript',
        transcript: {
          id: typeof packet.id === 'string' ? packet.id : createId(),
          role: packet.speaker === 'user' || packet.role === 'user' ? 'user' : 'assistant',
          text: packet.text.trim(),
          isFinal: packet.is_final !== false,
          timestamp: typeof packet.timestamp === 'number' ? packet.timestamp : now,
        },
      };
    }
    if (packet.type === 'task_update' && packet.task && typeof packet.task === 'object') {
      return { type: 'task_update', task: packet.task as VoiceBotTask };
    }
  } catch {
    // Ignore malformed or unrelated packets without dropping the call.
  }
  return null;
}
