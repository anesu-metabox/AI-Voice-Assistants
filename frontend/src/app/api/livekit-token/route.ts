import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      status: "error",
      error_code: "LEGACY_VOICE_PATH_DISABLED",
      error_message: "Use the authenticated LiveKit session endpoint.",
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
