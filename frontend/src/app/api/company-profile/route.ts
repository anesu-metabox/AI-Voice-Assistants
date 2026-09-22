import { proxyBackend } from "@/lib/backendProxy";

export async function GET(request: Request) {
  return proxyBackend(request, "/company-profile");
}

export async function POST(request: Request) {
  return proxyBackend(request, "/company-profile");
}
