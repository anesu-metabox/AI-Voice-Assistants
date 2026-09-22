import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      error: "Browser-direct Gemini voice is disabled. Use the LiveKit voice session.",
      error_code: "DIRECT_VOICE_DISABLED",
    },
    {
      status: 410,
      headers: { "cache-control": "no-store" },
    },
  );
}
