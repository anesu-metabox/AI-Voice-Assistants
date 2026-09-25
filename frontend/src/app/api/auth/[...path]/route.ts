import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/backendProxy";
import { logSafeFailure } from "@/lib/safeLogging";
import { isMockMode } from "@/lib/mockMode";
import { handleMockAuth } from "@/mocks/mockStore";

const AUTH_URL = (process.env.NEON_AUTH_URL || process.env.NEON_AUTH_BASE_URL || "").replace(/\/+$/, "");
type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params;
  if (isMockMode()) {
    return handleMockAuth(request, path);
  }
  if (!AUTH_URL) return NextResponse.json({ error: "Neon Auth is not configured." }, { status: 503 });
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin mutation rejected." }, { status: 403 });
  }
  const incoming = new URL(request.url);
  const target = `${AUTH_URL}/${path.join("/")}${incoming.search}`;
  const headers = new Headers();
  for (const name of ["accept", "content-type", "cookie", "user-agent", "origin"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  try {
    const response = await fetch(target, { method: request.method, headers, body, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15000) });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "location", "cache-control"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.bind(response.headers);
    for (const cookie of getSetCookie?.() || []) responseHeaders.append("set-cookie", cookie);
    if (!getSetCookie) {
      const cookie = response.headers.get("set-cookie");
      if (cookie) responseHeaders.set("set-cookie", cookie);
    }
    responseHeaders.set("cache-control", "no-store");
    return new NextResponse(await response.arrayBuffer(), { status: response.status, headers: responseHeaders });
  } catch (error) {
    logSafeFailure("Neon Auth proxy request failed", error);
    return NextResponse.json({ error: "Neon Auth is unavailable." }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
