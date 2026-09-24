/**
 * Shared TypeScript Definitions for Voice Bot Dashboard
 * Synchronized with Backend Pydantic Schemas (Sprint 1)
 */

export type SpeakerRole = "user" | "assistant";

export interface TranscriptMessage {
  id: string;
  speaker: SpeakerRole;
  text: string;
  isInterrupted?: boolean;
  timestamp: string;
}

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "needs_reconnect" | "cancelled";

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

export type { LiveKitConnectionStatus as ConnectionStatus } from "./livekitSessionRuntime";

export interface AudioVisualizerProps {
  analyserNode?: AnalyserNode | null;
  isBotSpeaking?: boolean;
  isUserSpeaking?: boolean;
}

// ------------------------------------------------------------------------------
// Tool Result Contracts (Synchronized with backend/app/schemas/tools.py)
// ------------------------------------------------------------------------------

export interface CalendarAvailabilityResult {
  date: string;
  available_slots: string[];
  duration_minutes: number;
  timezone: string;
  source: string;
}

export interface BookEventResult {
  event_id: string;
  title: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  attendees: string[];
  meet_link?: string | null;
  status: "confirmed";
  source: string;
}

export interface CancelEventResult {
  event_id: string;
  status: "cancelled";
  cancelled_at: string;
  reason?: string | null;
}

export interface ContactItem {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
}

export interface SearchContactsResult {
  query: string;
  count: number;
  contacts: ContactItem[];
  source: string;
}

export interface DraftEmailResult {
  draft_id: string;
  recipient_email: string;
  subject: string;
  body_snippet: string;
  status: "drafted";
  source: string;
}

export interface DurableTaskResult {
  task_id: string;
  title: string;
  status: "pending" | "running";
  tracking_url?: string | null;
  spoken_ack: string;
}

export interface ConfirmationRequiredResult {
  status: "confirmation_required";
  confirmation_token: string;
  prompt_to_speak: string;
  tool_name: string;
  impact_summary: {
    action: string;
    parameters: Record<string, any>;
  };
}

export interface ToolExecutionResponse<T = Record<string, any>> {
  status: "success" | "error" | "conflict" | "confirmation_required";
  data?: T | null;
  execution_time_ms: number;
  error_message?: string | null;
  error_code?: string | null;
  idempotency_key?: string | null;
}
