import { NextRequest, NextResponse } from "next/server";
import { proxyBackend } from "@/lib/backendProxy";

interface RouteParams { params: Promise<{ taskId: string }> }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { taskId } = await params;
  if (!taskId) return NextResponse.json({ error: "taskId parameter is required" }, { status: 400 });
  return proxyBackend(req, `/tasks/${encodeURIComponent(taskId)}/status`, { timeoutMs: 10000 });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { taskId } = await params;
  if (!taskId) return NextResponse.json({ error: "taskId parameter is required" }, { status: 400 });
  return proxyBackend(req, `/tasks/${encodeURIComponent(taskId)}/cancel`, { timeoutMs: 10000 });
}
