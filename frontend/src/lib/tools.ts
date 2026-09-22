import { FunctionDeclaration, Type } from "@google/genai";
import { isAllowedCalendarTool } from "./assistantPolicy";
import { logSafeFailure } from "./safeLogging";

export const calendarToolDeclarations: FunctionDeclaration[] = [
  {
    name: "get_calendar_availability",
    description: "Query calendar availability to find free slots on a given date or range. Use this when the user asks what dates/times are open, checks their schedule, or wants to see free slots.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        start_date: {
          type: Type.STRING,
          description: "Start date or ISO datetime to query in YYYY-MM-DD format (e.g. '2026-09-25'). Defaults to today.",
        },
        end_date: {
          type: Type.STRING,
          description: "End date or ISO datetime to query in YYYY-MM-DD format (e.g. '2026-09-25'). Defaults to start_date.",
        },
        duration_minutes: {
          type: Type.INTEGER,
          description: "Required meeting duration in minutes (default 30).",
        },
      },
    },
  },
  {
    name: "book_event",
    description: "Book and persist a new calendar meeting or event into the database. Use this when the user wants to schedule an appointment, reserve a slot, or book a meeting.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "Title or subject of the meeting/event.",
        },
        start_time: {
          type: Type.STRING,
          description: "Start time in ISO 8601 format (e.g. '2026-09-25T14:00:00Z').",
        },
        duration_minutes: {
          type: Type.INTEGER,
          description: "Meeting duration in minutes (default 30).",
        },
        attendees: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "List of attendee emails or participant names.",
        },
        description: {
          type: Type.STRING,
          description: "Optional meeting notes or agenda description.",
        },
      },
      required: ["title", "start_time"],
    },
  },
  {
    name: "cancel_event",
    description: "Cancel an existing scheduled calendar event. Use this when the user requests to cancel or remove a meeting.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_id: {
          type: Type.STRING,
          description: "The unique UUID identifier of the calendar event to cancel.",
        },
        reason: {
          type: Type.STRING,
          description: "Optional reason for cancellation.",
        },
        confirm: {
          type: Type.BOOLEAN,
          description: "Set to true if the user explicitly confirmed cancellation, false otherwise.",
        },
        confirmation_token: {
          type: Type.STRING,
          description: "Exact token returned by the prior confirmation_required response.",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "list_events",
    description: "Retrieve all confirmed meetings and events from the database for a given date or range. Use this when the user asks 'what meetings do I have today?', 'what is on my calendar?', 'do I have anything scheduled?', or any question about existing bookings.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        start_date: {
          type: Type.STRING,
          description: "Start date in YYYY-MM-DD format. Defaults to today.",
        },
        end_date: {
          type: Type.STRING,
          description: "End date in YYYY-MM-DD format. Defaults to start_date.",
        },
      },
    },
  },
];

export interface ToolExecutionResponse {
  status: "success" | "conflict" | "confirmation_required" | "error";
  data?: any;
  error?: string;
  error_message?: string;
  execution_time_ms?: number;
  conflicting_event?: any;
  next_available_slot?: string;
  [key: string]: any;
}

export async function executeBackendTool(
  toolName: string,
  parameters: Record<string, any>,
  idempotencyKey?: string,
): Promise<ToolExecutionResponse> {
  if (!isAllowedCalendarTool(toolName)) {
    return {
      status: "error",
      error_code: "POLICY_TOOL_DENIED",
      error_message: `Tool '${toolName}' is not enabled for the calendar-only assistant.`,
    };
  }

  try {
    const res = await fetch("/api/tools/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
        body: JSON.stringify({
          tool_name: toolName,
          parameters,
          idempotency_key: idempotencyKey ?? null,
        }),
    });

    const data = await res.json();
    return data;
  } catch (err: any) {
    logSafeFailure("Calendar tool request failed", err);
    return {
      status: "error",
      error_code: "TOOL_REQUEST_FAILED",
      error_message: "The calendar action could not be completed. Please try again.",
    };
  }
}
