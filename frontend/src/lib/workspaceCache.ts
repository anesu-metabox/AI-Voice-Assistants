export type CompanyProfile = {
  id?: string;
  user_id?: string;
  company_name: string;
  website_url: string;
  company_phone: string;
  support_email: string;
  timezone: string;
  created_at?: string;
  updated_at?: string;
};

type SessionPayload = {
  user?: { name?: string; email?: string; id?: string };
  session?: { user?: { name?: string; email?: string; id?: string } };
};

const EMPTY_PROFILE: CompanyProfile = {
  company_name: "",
  website_url: "",
  company_phone: "",
  support_email: "",
  timezone: "Indian/Mauritius",
};
const CACHE_TTL_MS = 30_000;

let profile: CompanyProfile | null = null;
let profileCachedAt = 0;
let profileRequest: Promise<CompanyProfile | null> | null = null;
let session: SessionPayload | null = null;
let sessionCachedAt = 0;
let sessionRequest: Promise<SessionPayload | null> | null = null;

async function readJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!response.ok) return null;
  return await response.json() as T;
}

export function getCachedCompanyProfile(): CompanyProfile | null {
  return profile;
}

export function setCachedCompanyProfile(value: Partial<CompanyProfile> | null): CompanyProfile | null {
  if (!value) {
    profile = null;
    profileCachedAt = 0;
    return profile;
  }
  profile = { ...EMPTY_PROFILE, ...profile, ...value };
  profileCachedAt = Date.now();
  return profile;
}

export async function getCompanyProfile(options: { force?: boolean } = {}): Promise<CompanyProfile | null> {
  if (profile && !options.force && Date.now() - profileCachedAt < CACHE_TTL_MS) return profile;
  if (profileRequest && !options.force) return profileRequest;
  profileRequest = readJson<{ data?: CompanyProfile }>("/api/company-profile")
    .then((payload) => setCachedCompanyProfile(payload?.data || null))
    .catch(() => null)
    .finally(() => { profileRequest = null; });
  return profileRequest;
}

export function getCachedSession(): SessionPayload | null {
  return session;
}

export async function getSession(options: { force?: boolean; query?: string } = {}): Promise<SessionPayload | null> {
  if (session && !options.force && !options.query && Date.now() - sessionCachedAt < CACHE_TTL_MS) return session;
  if (sessionRequest && !options.force && !options.query) return sessionRequest;
  sessionRequest = readJson<SessionPayload>(`/api/auth/get-session${options.query || ""}`)
    .then((payload) => { session = payload; sessionCachedAt = payload ? Date.now() : 0; return payload; })
    .catch(() => null)
    .finally(() => { sessionRequest = null; });
  return sessionRequest;
}

export function clearWorkspaceCache(): void {
  profile = null;
  profileCachedAt = 0;
  session = null;
  sessionCachedAt = 0;
}
