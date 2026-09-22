import { proxyBackend } from "@/lib/backendProxy";

type RouteContext = { params: Promise<{ path: string }> };

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return proxyBackend(request, `/auth/google/${path}`, {
    timeoutMs: 30000,
    retries: 1,
  });
}

export const GET = forward;
export const POST = forward;
