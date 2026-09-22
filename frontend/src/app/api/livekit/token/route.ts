import { proxyBackend } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Session IDs make this request idempotent, so one retry is safe during a
  // transient backend restart. Room/dispatch creation can take several seconds.
  return proxyBackend(request, "/livekit/token", { timeoutMs: 30000, retries: 1 });
}
