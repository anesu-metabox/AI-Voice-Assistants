import { proxyBackend } from "@/lib/backendProxy";

export async function GET(request: Request) {
  return proxyBackend(request, "/assistant-config");
}

export async function POST(request: Request) {
  return proxyBackend(request, "/assistant-config");
}
