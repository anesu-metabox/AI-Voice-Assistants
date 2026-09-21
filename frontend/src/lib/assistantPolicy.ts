import policyDocument from "./assistantPolicy.json";

export type CalendarToolName =
  | "get_calendar_availability"
  | "list_events"
  | "book_event"
  | "cancel_event";

export type ScopeDecisionReason =
  | "calendar_intent"
  | "calendar_follow_up"
  | "social"
  | "hard_diversion"
  | "off_topic"
  | "empty_input";

export interface ScopeDecision {
  action: "allow" | "redirect";
  reason: ScopeDecisionReason;
  calendarContextActive: boolean;
}

export interface AssistantPolicy {
  version: string;
  redirectResponse: string;
  allowedTools: CalendarToolName[];
  systemInstruction: string;
  patterns: {
    hardDiversion: string[];
    offTopic: string[];
    calendarIntent: string[];
    social: string[];
    calendarFollowUp: string[];
  };
}

export const ASSISTANT_POLICY = policyDocument as AssistantPolicy;
export const CALENDAR_SYSTEM_INSTRUCTION = ASSISTANT_POLICY.systemInstruction;
export const CALENDAR_REDIRECT_RESPONSE = ASSISTANT_POLICY.redirectResponse;

const allowedToolNames = new Set<string>(ASSISTANT_POLICY.allowedTools);
const compiledPatterns = Object.fromEntries(
  Object.entries(ASSISTANT_POLICY.patterns).map(([name, patterns]) => [
    name,
    patterns.map((pattern) => new RegExp(pattern, "i")),
  ]),
) as Record<keyof AssistantPolicy["patterns"], RegExp[]>;

function matches(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function isAllowedCalendarTool(toolName: string): toolName is CalendarToolName {
  return allowedToolNames.has(toolName);
}

export function classifyAssistantTurn(
  input: string,
  calendarContextActive = false,
): ScopeDecision {
  const text = input.trim().toLowerCase();
  if (!text) {
    return { action: "redirect", reason: "empty_input", calendarContextActive: false };
  }

  if (matches(compiledPatterns.hardDiversion, text)) {
    return { action: "redirect", reason: "hard_diversion", calendarContextActive: false };
  }

  if (matches(compiledPatterns.offTopic, text)) {
    return { action: "redirect", reason: "off_topic", calendarContextActive: false };
  }

  if (matches(compiledPatterns.calendarIntent, text)) {
    return { action: "allow", reason: "calendar_intent", calendarContextActive: true };
  }

  if (matches(compiledPatterns.social, text)) {
    return { action: "allow", reason: "social", calendarContextActive };
  }

  if (calendarContextActive && matches(compiledPatterns.calendarFollowUp, text)) {
    return { action: "allow", reason: "calendar_follow_up", calendarContextActive: true };
  }

  return { action: "redirect", reason: "off_topic", calendarContextActive: false };
}
