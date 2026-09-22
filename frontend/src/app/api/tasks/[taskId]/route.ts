import { NextRequest, NextResponse } from "next/server";
import { proxyBackend } from "@/lib/backendProxy";

interface RouteParams { params: { taskId: string } }

export async function GET(req: NextRequest, { params }: RouteParams) {
  if (!params.taskId) return NextResponse.json({ error: "taskId parameter is required" }, { status: 400 });
  return proxyBackend(req, `/tasks/${encodeURIComponent(params.taskId)}/status`, { timeoutMs: 10000 });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!params.taskId) return NextResponse.json({ error: "taskId parameter is required" }, { status: 400 });
  return proxyBackend(req, `/tasks/${encodeURIComponent(params.taskId)}/cancel`, { timeoutMs: 10000 });
}
