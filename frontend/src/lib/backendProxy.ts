import { NextResponse } from "next/server";
import { contextHeader, getVerifiedRequestContext } from "@/lib/sessionContext";
import { logSafeFailure } from "@/lib/safeLogging";

const BACKEND_URL = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

type ProxyBackendOptions = {
  timeoutMs?: number;
  retries?: number;
  requireRecentAuth?: boolean;
  recentAuthWindowMs?: number;
};

export function isSameOriginMutation(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

export async function proxyBackend(
  request: Request,
  backendPath: string,
  options: ProxyBackendOptions = {},
) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ status: "error", error_code: "CSRF_REJECTED", error_message: "Cross-origin mutation rejected." }, { status: 403 });
  }
  const incomingUrl = new URL(request.url);
  // Tenant identity is resolved from the authenticated session, never from a
  // browser-controlled query parameter. Preserve functional parameters such
  // as session_id while removing legacy identity selectors.
  incomingUrl.searchParams.delete("user_id");
  const targetUrl = `${BACKEND_URL}${backendPath}${incomingUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("cookie");
  headers.delete("x-verified-session-context");
  const context = await getVerifiedRequestContext(request);
  if (!context) {
    return NextResponse.json(
      { status: "error", error_code: "AUTHENTICATION_REQUIRED", error_message: "Sign in is required." },
      { status: 401 },
    );
  }
  if (options.requireRecentAuth) {
    const freshnessWindowMs = options.recentAuthWindowMs ?? 10 * 60 * 1000;
    const sessionAgeMs = context.sessionCreatedAt === null ? Number.POSITIVE_INFINITY : Date.now() - context.sessionCreatedAt;
    if (sessionAgeMs < 0 || sessionAgeMs > freshnessWindowMs) {
      return NextResponse.json(
        { status: "error", error_code: "RECENT_AUTHENTICATION_REQUIRED", error_message: "Sign in again before changing 3CX integration credentials." },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
  }
  headers.set("x-verified-session-context", contextHeader(context));
  const timeoutMs = options.timeoutMs ?? 15000;
  const retries = options.retries ?? 0;
  const body = request.method !== "GET" && request.method !== "HEAD"
    ? await request.arrayBuffer()
    : undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseBody = await response.arrayBuffer();
      const responseHeaders = new Headers();
      const contentType = response.headers.get("content-type");
      if (contentType) responseHeaders.set("content-type", contentType);
      const location = response.headers.get("location");
      if (location) responseHeaders.set("location", location);
      responseHeaders.set("cache-control", "no-store");

      return new NextResponse(responseBody, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (error) {
      logSafeFailure("Backend proxy request failed", error);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  return NextResponse.json(
    {
      status: "error",
      error_code: "BACKEND_PROXY_ERROR",
      error_message: "The backend service is unavailable. Confirm the FastAPI service is running on port 8000.",
    },
    { status: 502 },
  );
}
