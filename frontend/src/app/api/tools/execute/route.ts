import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tool_name, parameters = {}, user_id, idempotency_key } = body;

    if (!tool_name) {
      return NextResponse.json(
        { error: "tool_name is required" },
        { status: 400 }
      );
    }

    const payload = {
      tool_name,
      parameters,
      user_id: user_id || DEFAULT_USER_ID,
      idempotency_key: idempotency_key || null,
    };

    const targetUrl = `${BACKEND_URL}/tools/execute`;
    const backendRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseData = await backendRes.json();
    return NextResponse.json(responseData, { status: backendRes.status });
  } catch (err: any) {
    console.error("Error proxying tool execution to backend:", err);
    return NextResponse.json(
      {
        status: "error",
        error_message: `Backend proxy failure: ${err?.message || String(err)}`,
      },
      { status: 502 }
    );
  }
}
