import { NextRequest, NextResponse } from "next/server";
import { logSafeFailure } from "@/lib/safeLogging";
import { isAllowedCalendarTool } from "@/lib/assistantPolicy";
import { contextHeader, getVerifiedRequestContext } from "@/lib/sessionContext";
import { isSameOriginMutation } from "@/lib/backendProxy";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(req: NextRequest) {
  try {
    if (!isSameOriginMutation(req)) {
      return NextResponse.json({ status: "error", error_code: "CSRF_REJECTED", error_message: "Cross-origin mutation rejected." }, { status: 403 });
    }
    const body = await req.json();
    const { tool_name, parameters = {}, session_id, idempotency_key } = body;

    if (!tool_name) {
      return NextResponse.json(
        { error: "tool_name is required" },
        { status: 400 }
      );
    }

    if (!isAllowedCalendarTool(tool_name)) {
      return NextResponse.json(
        {
          status: "error",
          error_code: "POLICY_TOOL_DENIED",
          error_message: `Tool '${tool_name}' is not enabled for the calendar-only assistant.`,
        },
        { status: 403 },
      );
    }

    const payload = {
      tool_name,
      parameters,
      session_id: session_id || null,
      idempotency_key: idempotency_key || null,
    };

    // Forward the authenticated browser context to FastAPI. Tenant identity is
    // resolved by the backend from the session; it must never come from the
    // request body or from model-generated tool arguments.
    const context = await getVerifiedRequestContext(req);
    if (!context) {
      return NextResponse.json(
        { status: "error", error_code: "AUTHENTICATION_REQUIRED", error_message: "Sign in is required." },
        { status: 401 },
      );
    }
    // The incoming Neon Auth cookie is verified server-side and represented to
    // FastAPI by the signed tenant context; raw cookie or authorization headers
    // are never trusted by the backend.
    const forwardedHeaders = new Headers();
    forwardedHeaders.set("x-verified-session-context", contextHeader(context));
    forwardedHeaders.set("content-type", "application/json");

    const targetUrl = `${BACKEND_URL.replace(/\/+$/, "")}/tools/execute`;
    const backendRes = await fetch(targetUrl, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    let responseData: any;
    const responseText = await backendRes.text();
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = {
        status: backendRes.ok ? "success" : "error",
        error_code: "INVALID_BACKEND_RESPONSE",
        error_message: "The backend returned an unreadable response.",
      };
    }

    return NextResponse.json(responseData, { status: backendRes.status });
  } catch (err: any) {
    logSafeFailure("Tool execution proxy failed", err);
    return NextResponse.json(
      {
        status: "error",
        error_code: "BACKEND_PROXY_ERROR",
        error_message: "The backend service is unavailable. Please try again.",
      },
      { status: 502 }
    );
  }
}
