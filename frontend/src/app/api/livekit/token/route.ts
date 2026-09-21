import { proxyBackend } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyBackend(request, "/livekit/token");
}
