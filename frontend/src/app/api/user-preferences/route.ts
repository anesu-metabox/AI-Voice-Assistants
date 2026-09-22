import { proxyBackend } from "@/lib/backendProxy";

export async function GET(request: Request) {
  return proxyBackend(request, "/user-preferences");
}

export async function PUT(request: Request) {
  return proxyBackend(request, "/user-preferences");
}
