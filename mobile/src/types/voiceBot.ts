/**
 * TypeScript definitions for Voice Bot Integration
 * Milestone M2: Token API Service & Voice Bot State Machine
 */

export interface LiveKitTokenResponse {
  token: string;
  wsUrl: string;
  room: string;
  identity: string;
  sessionId?: string | null;
}

export interface LiveKitSessionConfig {
  sessionId?: string;
  participantName?: string;
  profileVersion?: number;
}

export type VoiceBotStatus =
  | 'disconnected'
  | 'connecting'
  | 'waiting_for_agent'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface VoiceBotTranscript {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface VoiceBotTask {
  id?: string;
  title?: string;
  tool_name?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  output_result?: any;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface VoiceBotError {
  code: string;
  message: string;
  status?: number;
}

export interface VoiceBotAudioLevel {
  local: number;
  remote: number;
}

export interface VoiceBotState {
  status: VoiceBotStatus;
  isConnected: boolean;
  isBotSpeaking: boolean;
  isUserSpeaking: boolean;
  isMuted: boolean;
  isSpeakerphoneOn: boolean;
  localAudioLevel: number;
  remoteAudioLevel: number;
  transcripts: VoiceBotTranscript[];
  activeTask: VoiceBotTask | null;
  error: VoiceBotError | null;
}

export interface InterruptResult {
  interrupted: boolean;
  reason?: 'muted' | 'bot_not_speaking' | 'speech_ended' | string;
  elapsedMs?: number;
}

export interface VoiceBotActions {
  initiateCall: (config?: LiveKitSessionConfig) => Promise<LiveKitTokenResponse | null>;
  endCall: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleSpeakerphone: () => Promise<void>;
  interrupt: () => Promise<InterruptResult>;
}

export type VoiceBotHookReturn = VoiceBotState & VoiceBotActions;

export interface VoiceBotBadge {
  label: string;
  color: string;
  pulsing: boolean;
}

export function getVoiceAssistantBadge(status: VoiceBotStatus): VoiceBotBadge {
  switch (status) {
    case 'disconnected':
      return { label: 'Offline', color: 'gray', pulsing: false };
    case 'connecting':
      return { label: 'Connecting...', color: 'yellow', pulsing: true };
    case 'waiting_for_agent':
      return { label: 'Waiting for Agent...', color: 'blue', pulsing: true };
    case 'connected':
      return { label: 'Live Call', color: 'green', pulsing: true };
    case 'reconnecting':
      return { label: 'Reconnecting...', color: 'orange', pulsing: true };
    case 'error':
      return { label: 'Connection Error', color: 'red', pulsing: false };
    default:
      return { label: 'Unknown', color: 'gray', pulsing: false };
  }
}

/**
 * DataChannel Packets
 */
export interface CancelPacket {
  type: 'response.cancel';
}

export interface TranscriptPacket {
  type: 'transcript';
  id?: string;
  role?: 'user' | 'assistant';
  text: string;
  is_final?: boolean;
  timestamp?: number;
}

export interface TaskUpdatePacket {
  type: 'task_update';
  task: VoiceBotTask;
}

export type IncomingDataPacket = TranscriptPacket | TaskUpdatePacket | { type: string; [key: string]: any };
