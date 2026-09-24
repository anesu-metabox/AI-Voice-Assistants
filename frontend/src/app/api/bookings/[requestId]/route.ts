import { NextRequest, NextResponse } from "next/server";
import { proxyBackend } from "@/lib/backendProxy";

interface RouteParams { params: Promise<{ requestId: string }> }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { requestId } = await params;
  if (!requestId) return NextResponse.json({ error: "requestId parameter is required" }, { status: 400 });
  return proxyBackend(req, `/bookings/${encodeURIComponent(requestId)}`, { timeoutMs: 10000 });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { requestId } = await params;
  if (!requestId) return NextResponse.json({ error: "requestId parameter is required" }, { status: 400 });
  return proxyBackend(req, `/bookings/${encodeURIComponent(requestId)}/cancel`, { timeoutMs: 10000 });
}
