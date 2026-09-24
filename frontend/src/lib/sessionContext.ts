import { createHash, createHmac } from "node:crypto";

type NeonAuthResponse = {
  user?: { id?: string };
  session?: { id?: string; createdAt?: string | number; user?: { id?: string } };
};

export type VerifiedRequestContext = {
  session_id: string;
  company_id: string;
  auth_subject: string;
  issued_at: number;
  signature: string;
  /** Server-verified Better Auth session creation time; never forwarded as a trust claim. */
  sessionCreatedAt: number | null;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function stableCompanyId(userId: string): string {
  const hex = createHash("sha256").update(`company:${userId}`).digest("hex").slice(0, 32);
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20)}`;
}

async function readNeonSession(cookie: string): Promise<{ userId: string; sessionId: string; sessionCreatedAt: number | null } | null> {
  const authUrl = (process.env.NEON_AUTH_URL || process.env.NEON_AUTH_BASE_URL || required("NEON_AUTH_URL")).replace(/\/+$/, "");
  const response = await fetch(`${authUrl}/get-session`, {
    headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as NeonAuthResponse;
  const userId = payload.user?.id || payload.session?.user?.id;
  const sessionId = payload.session?.id;
  const rawCreatedAt = payload.session?.createdAt;
  const parsedCreatedAt = typeof rawCreatedAt === "number"
    ? rawCreatedAt
    : typeof rawCreatedAt === "string" ? Date.parse(rawCreatedAt) : Number.NaN;
  const sessionCreatedAt = Number.isFinite(parsedCreatedAt)
    ? (parsedCreatedAt > 10_000_000_000 ? parsedCreatedAt : parsedCreatedAt * 1000)
    : null;
  return userId && sessionId ? { userId, sessionId, sessionCreatedAt } : null;
}

export async function getVerifiedRequestContext(request: Request): Promise<VerifiedRequestContext | null> {
  const cookie = request.headers.get("cookie");
  let auth: { userId: string; sessionId: string; sessionCreatedAt: number | null } | null = null;
  if (cookie) {
    try {
      auth = await readNeonSession(cookie);
    } catch {
      auth = null;
    }
  }

  // Local development fallback for Sandbox / testing if unauthenticated
  if (!auth && (process.env.NODE_ENV === "development" || process.env.ALLOW_DEV_LOCAL_AUTH === "true")) {
    auth = {
      userId: "local-dev-user",
      sessionId: "local-dev-session",
      sessionCreatedAt: Date.now(),
    };
  }

  if (!auth) return null;

  try {
    const requestedSession = new URL(request.url).searchParams.get("session_id");
    const sessionId = requestedSession || auth.sessionId;
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(sessionId)) return null;
    const companyId = stableCompanyId(auth.userId);
    const issuedAt = Math.floor(Date.now() / 1000);
    const message = JSON.stringify({ auth_subject: auth.userId, company_id: companyId, issued_at: issuedAt, session_id: sessionId });
    const signingSecret = process.env.LIVEKIT_SESSION_CONTEXT_SECRET || required("LIVEKIT_SESSION_CONTEXT_SECRET");
    const signature = createHmac("sha256", signingSecret)
      .update(message).digest("hex");
    return { session_id: sessionId, company_id: companyId, auth_subject: auth.userId, issued_at: issuedAt, signature, sessionCreatedAt: auth.sessionCreatedAt };
  } catch {
    return null;
  }
}

export function contextHeader(context: VerifiedRequestContext): string {
  const { sessionCreatedAt: _sessionCreatedAt, ...signedContext } = context;
  return JSON.stringify(signedContext);
}
