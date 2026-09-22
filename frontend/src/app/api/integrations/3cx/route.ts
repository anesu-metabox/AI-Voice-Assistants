import { proxyBackend } from "@/lib/backendProxy";

export async function GET(request: Request) {
  return proxyBackend(request, "/api/integrations/3cx");
}

export async function POST(request: Request) {
  return proxyBackend(request, "/api/integrations/3cx/test", { requireRecentAuth: true });
}

export async function PUT(request: Request) {
  return proxyBackend(request, "/api/integrations/3cx", { requireRecentAuth: true });
}

export async function DELETE(request: Request) {
  return proxyBackend(request, "/api/integrations/3cx", { requireRecentAuth: true });
}
