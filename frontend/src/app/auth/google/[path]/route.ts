import { proxyBackend } from "@/lib/backendProxy";

type RouteContext = { params: { path: string } };

async function forward(request: Request, context: RouteContext) {
  return proxyBackend(request, `/auth/google/${context.params.path}`, {
    timeoutMs: 30000,
    retries: 1,
  });
}

export const GET = forward;
export const POST = forward;
