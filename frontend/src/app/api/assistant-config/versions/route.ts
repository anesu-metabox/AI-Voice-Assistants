import { proxyBackend } from "@/lib/backendProxy";

export async function GET(request: Request) {
  return proxyBackend(request, "/assistant-config/versions");
}
