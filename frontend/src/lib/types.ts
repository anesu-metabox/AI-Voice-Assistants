/**
 * Shared TypeScript Definitions for Voice Bot Dashboard
 */

export type SpeakerRole = "user" | "assistant";

export interface TranscriptMessage {
  id: string;
  speaker: SpeakerRole;
  text: string;
  isInterrupted?: boolean;
  timestamp: string;
}

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskItem {
  id: string;
  title: string;
  toolName: string;
  status: TaskStatus;
  output?: Record<string, any> | null;
  errorMessage?: string | null;
  executionTimeMs?: number;
  idempotencyKey?: string | null;
  updatedAt: string;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface AudioVisualizerProps {
  analyserNode?: AnalyserNode | null;
  isBotSpeaking?: boolean;
  isUserSpeaking?: boolean;
}
