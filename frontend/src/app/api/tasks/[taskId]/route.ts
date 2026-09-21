import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

interface RouteParams {
  params: {
    taskId: string;
  };
}

/**
 * GET /api/tasks/[taskId]
 * Queries the current status of an asynchronous background task from FastAPI.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { taskId } = params;

  if (!taskId) {
    return NextResponse.json(
      { error: "taskId parameter is required" },
      { status: 400 }
    );
  }

  try {
    const targetUrl = `${BACKEND_URL.replace(/\/+$/, "")}/tasks/${encodeURIComponent(taskId)}/status`;
    const backendRes = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    let data: any;
    const text = await backendRes.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }

    return NextResponse.json(data, { status: backendRes.status });
  } catch (err: any) {
    console.error(`Error querying status for task ${taskId}:`, err);
    return NextResponse.json(
      {
        error: `Failed to query task status from backend: ${err?.message || String(err)}`,
      },
      { status: 502 }
    );
  }
}

/**
 * POST /api/tasks/[taskId]
 * Requests cancellation of a pending or running background task via FastAPI.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { taskId } = params;

  if (!taskId) {
    return NextResponse.json(
      { error: "taskId parameter is required" },
      { status: 400 }
    );
  }

  try {
    const targetUrl = `${BACKEND_URL.replace(/\/+$/, "")}/tasks/${encodeURIComponent(taskId)}/cancel`;
    const backendRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    let data: any;
    const text = await backendRes.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }

    return NextResponse.json(data, { status: backendRes.status });
  } catch (err: any) {
    console.error(`Error cancelling task ${taskId}:`, err);
    return NextResponse.json(
      {
        cancelled: false,
        error: `Failed to cancel task via backend: ${err?.message || String(err)}`,
      },
      { status: 502 }
    );
  }
}
