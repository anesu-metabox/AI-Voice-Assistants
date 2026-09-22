type LogLevel = "error" | "warn";

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "NonError";
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : "Error";
}

/** Log failure categories only; exception messages can contain user data or secrets. */
export function logSafeFailure(label: string, error: unknown, level: LogLevel = "error"): void {
  const metadata = { errorType: safeErrorType(error) };
  if (level === "warn") console.warn(label, metadata);
  else console.error(label, metadata);
}
