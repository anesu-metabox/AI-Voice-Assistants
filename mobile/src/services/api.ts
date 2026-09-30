/**
 * API Service for vocalist.ai Mobile Client
 * Communicates strictly via HTTP REST endpoints (FastAPI / Next.js token route)
 * NO DIRECT DATABASE ACCESS (Rule of Engagement #3)
 */

function requestOrigin(webBase: string): string {
  try {
    return new URL(webBase).origin;
  } catch {
    return webBase;
  }
}

export interface BackendHealth {
  status: 'healthy' | 'unhealthy' | 'unreachable';
  service?: string;
  version?: string;
  database?: string;
  latencyMs?: number;
}

export interface UserAccount {
  id: string;
  email?: string;
  name?: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user?: UserAccount;
  session?: {
    id: string;
    createdAt?: number | string;
  };
}

export interface ToolExecutionResponse {
  status: 'success' | 'error' | 'confirmation_required';
  data?: any;
  error_message?: string;
  transaction_id?: string;
}

export interface LiveKitTokenResponse {
  token: string;
  wsUrl: string;
  room: string;
  identity: string;
}

export interface GoogleAuthStatus {
  connected: boolean;
  provider?: string;
  google_email?: string;
  email?: string;
  expires_at?: string;
  is_expired?: boolean;
  can_refresh?: boolean;
  scope?: string;
}

export interface CompanyProfile {
  company_name: string;
  website_url?: string;
  company_phone?: string;
  support_email?: string;
  timezone?: string;
}

export interface FAQEntry {
  question: string;
  answer: string;
}

export interface AssistantConfig {
  assistant_name: string;
  voice_engine: string;
  inbound_greeting: string;
  system_prompt: string;
  knowledge_base_notes: string;
  tone: 'professional' | 'friendly' | 'warm' | 'concise';
  business_hours: Record<string, string>;
  escalation_rules: string[];
  faq_entries: FAQEntry[];
  capabilities: {
    company_receptionist: boolean;
    company_faq: boolean;
    google_calendar: boolean;
  };
  is_deployed?: boolean;
}

export interface AssistantVersion {
  version: number;
  lifecycle_state: 'draft' | 'published' | 'archived';
  created_at?: string;
}

export interface ThreeCXStatus {
  configured?: boolean;
  state?: 'active' | 'unconfigured' | 'error' | string;
  connectionName?: string;
  pbxHost?: string;
  appId?: string;
  routePointDn?: string;
  dids?: string[];
  transferDestinations?: string[];
  failureAction?: '' | 'disconnect' | 'transfer';
  failureDestination?: string;
  error?: string;
}

export interface ThreeCXPayload {
  connection_name: string;
  pbx_url: string;
  app_id: string;
  route_point_dn: string;
  client_secret: string;
  dids: string[];
  transfer_destinations: string[];
  failure_action: string;
  failure_destination: string | null;
}

export interface CallRecord {
  id: string | number;
  did: string;
  direction: 'inbound' | 'outbound';
  state: string;
  status: 'Ended' | 'Failed' | 'Active' | 'Ringing';
  duration: string;
  durationSeconds: number;
  dateTime: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string | null;
  pbxHost?: string;
  routePointDn?: string;
  transcriptId?: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  tool_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  output_result?: any;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

class ApiService {
  private backendUrl: string;
  private tokenEndpoint: string;
  private livekitUrl: string;

  constructor() {
    // Expo replaces explicit EXPO_PUBLIC_* references at bundle time. Do not
    // use process.env[key] here: Metro cannot inline dynamic environment
    // lookups, which would make a release APK fall back to localhost.
    const publicEnv: Record<string, string | undefined> = {
      EXPO_PUBLIC_APP_URL: process.env.EXPO_PUBLIC_APP_URL,
      EXPO_PUBLIC_BACKEND_URL: process.env.EXPO_PUBLIC_BACKEND_URL,
      EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
      EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT: process.env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT,
      EXPO_PUBLIC_LIVEKIT_URL: process.env.EXPO_PUBLIC_LIVEKIT_URL,
    };
    const getEnv = (key: string, fallback: string): string => {
      return publicEnv[key] || fallback;
    };

    this.backendUrl = getEnv('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').replace(/\/+$/, '');
    const appUrl = getEnv(
      'EXPO_PUBLIC_APP_URL',
      getEnv('EXPO_PUBLIC_WEB_URL', 'http://localhost:3000')
    ).replace(/\/+$/, '');
    this.tokenEndpoint = getEnv(
      'EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT',
      `${appUrl}/api/livekit/token`
    );
    this.livekitUrl = getEnv('EXPO_PUBLIC_LIVEKIT_URL', 'wss://ai-voice-assistant-vu6rr406.livekit.cloud');
  }

  public getWebBase(): string {
    if (this.tokenEndpoint) {
      return this.tokenEndpoint.replace(/\/api\/livekit(?:\/token|-token).*$/, '');
    }
    return this.backendUrl;
  }

  public getBackendUrl(): string {
    return this.backendUrl;
  }

  public setBackendUrl(url: string) {
    this.backendUrl = url.replace(/\/+$/, '');
  }

  public getTokenEndpoint(): string {
    return this.tokenEndpoint;
  }

  public setTokenEndpoint(endpoint: string) {
    this.tokenEndpoint = endpoint;
  }

  public getLiveKitUrl(): string {
    return this.livekitUrl;
  }

  public setLiveKitUrl(url: string) {
    this.livekitUrl = url;
  }

  // ─── Authentication (Neon Auth) ───────────────────────────────────────────

  /**
   * Verify whether the client currently holds an active Neon Auth session.
   */
  async checkSession(): Promise<SessionResponse> {
    const webBase = this.getWebBase();
    try {
      const res = await fetch(`${webBase}/api/auth/get-session`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return { authenticated: false };
      }

      const data = await res.json().catch(() => null);
      const user = data?.user || data?.session?.user;
      if (!user) {
        return { authenticated: false };
      }

      return {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        session: data.session,
      };
    } catch {
      return { authenticated: false };
    }
  }

  private getCallbackUrl(): string {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        return window.location.origin;
      }
    } catch {
      // Fall through for non-browser runtimes
    }
    return '/';
  }

  /**
   * Sign in using email and password via Neon Auth.
   */
  async signInEmail(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    const webBase = this.getWebBase();
    try {
      const callbackURL = this.getCallbackUrl();
      const res = await fetch(`${webBase}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: requestOrigin(webBase),
        },
        credentials: 'include',
        body: JSON.stringify({ email, password, callbackURL }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        return {
          success: false,
          error: payload.message || payload.error || 'Authentication failed. Please verify your credentials.',
        };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as any)?.message || 'Network connection failed during sign-in' };
    }
  }

  /**
   * Create account / sign up with email and password via Neon Auth.
   */
  async signUpEmail(email: string, password: string, name?: string): Promise<{ success: boolean; error?: string }> {
    const webBase = this.getWebBase();
    try {
      const callbackURL = this.getCallbackUrl();
      const resolvedName = name || email.split('@')[0];
      const res = await fetch(`${webBase}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: requestOrigin(webBase),
        },
        credentials: 'include',
        body: JSON.stringify({ email, password, name: resolvedName, callbackURL }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        return {
          success: false,
          error: payload.message || payload.error || 'Account creation failed.',
        };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as any)?.message || 'Network connection failed during sign-up' };
    }
  }

  /**
   * Request Google OAuth URL for social sign-in via Neon Auth.
   */
  async getGoogleSignInUrl(): Promise<string> {
    const webBase = this.getWebBase();
    const callbackURL = this.getCallbackUrl();
    const res = await fetch(`${webBase}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: requestOrigin(webBase),
      },
      credentials: 'include',
      body: JSON.stringify({ provider: 'google', callbackURL }),
      signal: AbortSignal.timeout(6000),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.url) {
      throw new Error(payload.message || 'Google sign-in is unavailable.');
    }
    return payload.url;
  }

  /**
   * Sign out current Neon Auth session.
   */
  async signOut(): Promise<{ success: boolean; error?: string }> {
    const webBase = this.getWebBase();
    try {
      const res = await fetch(`${webBase}/api/auth/sign-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: requestOrigin(webBase),
        },
        credentials: 'include',
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return { success: false, error: 'Sign out failed' };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as any)?.message || 'Network error during sign out' };
    }
  }

  // ─── Diagnostics & Tokens ─────────────────────────────────────────────────

  /**
   * Health probe verifying backend status and Neon PostgreSQL connection.
   */
  async checkBackendHealth(): Promise<BackendHealth> {
    const start = performance.now();
    try {
      const response = await fetch(`${this.backendUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        signal: AbortSignal.timeout(3500),
      });

      if (!response.ok) {
        return { status: 'unhealthy', latencyMs: Math.round(performance.now() - start) };
      }

      const data = await response.json();
      return {
        status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
        service: data.service,
        version: data.version,
        database: data.database,
        latencyMs: Math.round(performance.now() - start),
      };
    } catch {
      return {
        status: 'unreachable',
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }

  /**
   * Fetch room access token for LiveKit WebRTC session.
   */
  async fetchLiveKitToken(
    room: string = 'executive-voice-room',
    identity?: string
  ): Promise<LiveKitTokenResponse> {
    const url = new URL(this.tokenEndpoint);
    url.searchParams.set('room', room);
    if (identity) {
      url.searchParams.set('identity', identity);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch LiveKit token: HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      token: data.token,
      wsUrl: data.ws_url || data.wsUrl || this.livekitUrl,
      room: data.room || room,
      identity: data.identity || identity || 'mobile-user',
    };
  }

  /**
   * Dispatches tool execution request to central FastAPI dispatcher (POST /tools/execute).
   */
  async executeTool(toolName: string, args: Record<string, any> = {}): Promise<ToolExecutionResponse> {
    try {
      const response = await fetch(`${this.getWebBase()}/api/tools/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          Origin: requestOrigin(this.getWebBase()),
        },
        credentials: 'include',
        body: JSON.stringify({
          tool_name: toolName,
          parameters: args,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return {
          status: 'error',
          error_message: `Server returned HTTP ${response.status}`,
        };
      }

      return await response.json();
    } catch (err) {
      return {
        status: 'error',
        error_message: (err as any)?.message || 'Tool execution network failure',
      };
    }
  }

  // ─── Google OAuth Integration ─────────────────────────────────────────────

  /**
   * Check Google Calendar OAuth integration status.
   */
  async getGoogleAuthStatus(): Promise<GoogleAuthStatus> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/auth/google/status`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          return {
            connected: Boolean(data.connected),
            provider: data.provider || 'google',
            google_email: data.google_email || data.email,
            email: data.email || data.google_email,
            expires_at: data.expires_at,
            is_expired: data.is_expired,
            can_refresh: data.can_refresh,
            scope: data.scope,
          };
        }
      } catch {
        // Try next endpoint
      }
    }

    return { connected: false };
  }

  /**
   * Retrieve Google OAuth authorization URL.
   */
  async getGoogleAuthUrl(): Promise<string> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/auth/google/url`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.auth_url) {
            return data.auth_url;
          }
        }
      } catch {
        // Fall through
      }
    }

    throw new Error('Google authorization URL was not available.');
  }

  /**
   * Disconnect Google Calendar OAuth integration.
   */
  async disconnectGoogleAuth(): Promise<{ status: string }> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/auth/google/disconnect`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          return { status: data.status || 'disconnected' };
        }
      } catch {
        // Try next endpoint
      }
    }

    return { status: 'error' };
  }

  // ─── Company Profile & Assistant Configuration ───────────────────────────

  /**
   * Fetch company profile.
   */
  async getCompanyProfile(): Promise<CompanyProfile | null> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/company-profile`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data) return json.data;
        }
      } catch {
        // Continue fallback
      }
    }
    return null;
  }

  /**
   * Save or update company profile.
   */
  async saveCompanyProfile(profile: CompanyProfile): Promise<{ success: boolean; message?: string }> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/company-profile`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          body: JSON.stringify(profile),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return { success: true };
        }
      } catch {
        // Continue fallback
      }
    }
    return { success: false, message: 'Could not reach server to save company profile' };
  }

  /**
   * Fetch AI Assistant configuration draft and capabilities.
   */
  async getAssistantConfig(): Promise<AssistantConfig | null> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/assistant-config`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            const rawCap = json.data.capabilities || {};
            const capabilities = {
              company_receptionist: Boolean(rawCap.company_receptionist?.enabled ?? rawCap.company_receptionist ?? false),
              company_faq: Boolean(rawCap.company_faq?.enabled ?? rawCap.company_faq ?? false),
              google_calendar: Boolean(rawCap.google_calendar?.enabled ?? rawCap.google_calendar ?? true),
            };
            return {
              ...json.data,
              capabilities,
            };
          }
        }
      } catch {
        // Continue fallback
      }
    }
    return null;
  }

  /**
   * Save draft or publish assistant profile.
   */
  async saveAssistantConfig(
    config: AssistantConfig,
    deploy: boolean = false
  ): Promise<{ success: boolean; version?: number; message?: string }> {
    const webBase = this.getWebBase();
    
    const formattedCapabilities = {
      company_receptionist: { enabled: Boolean(config.capabilities.company_receptionist) },
      company_faq: { enabled: Boolean(config.capabilities.company_faq) },
      google_calendar: { enabled: Boolean(config.capabilities.google_calendar) },
    };

    const payload = {
      ...config,
      capabilities: formattedCapabilities,
      is_deployed: deploy,
    };

    if (deploy) {
      const validateEndpoints = [`${webBase}/api/assistant-config/validate`];
      for (const vUrl of validateEndpoints) {
        try {
          const vRes = await fetch(vUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Origin: requestOrigin(webBase) },
            credentials: 'include',
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
          });
          const vJson = await vRes.json().catch(() => null);
          if (vRes.ok && vJson?.status === 'valid') {
            break;
          }
        } catch {
          // Fall through
        }
      }
    }

    const endpoints = [`${webBase}/api/assistant-config`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const saved = await res.json().catch(() => null);
          return {
            success: true,
            version: saved?.data?.profile_version,
            message: deploy ? 'Assistant profile published successfully!' : 'Assistant draft saved.',
          };
        }
      } catch {
        // Fall through
      }
    }

    return {
      success: false,
      message: 'Network error or backend unavailable. (Local changes preserved)',
    };
  }

  /**
   * Fetch version history for assistant profiles.
   */
  async getAssistantVersions(): Promise<AssistantVersion[]> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/assistant-config/versions`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data)) return json.data;
        }
      } catch {
        // Fall through
      }
    }
    return [];
  }

  // ─── 3CX PBX Telephony Integration ────────────────────────────────────────

  /**
   * Fetch 3CX PBX connection status and configuration.
   */
  async getThreeCXStatus(): Promise<ThreeCXStatus> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/integrations/3cx`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall through
      }
    }
    return { configured: false, state: 'unconfigured' };
  }

  /**
   * Test and save 3CX PBX connection configuration.
   */
  async saveThreeCXConfig(payload: ThreeCXPayload): Promise<{ success: boolean; message?: string }> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/integrations/3cx`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          return { success: true };
        } else {
          const failure = await res.json().catch(() => null);
          return {
            success: false,
            message: failure?.detail || failure?.error_message || '3CX connection test failed',
          };
        }
      } catch {
        // Fall through
      }
    }
    return { success: false, message: 'Could not reach the server to save the 3CX configuration.' };
  }

  /**
   * Disconnect 3CX PBX integration.
   */
  async disconnectThreeCX(): Promise<{ success: boolean; message?: string }> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/integrations/3cx`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return { success: true };
        }
      } catch {
        // Fall through
      }
    }
    return { success: false, message: 'Could not reach the server to disconnect 3CX.' };
  }

  /**
   * Fetch live 3CX call history logs from database.
   */
  async getCallHistory(limit: number = 50): Promise<CallRecord[]> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/integrations/3cx/calls?limit=${limit}`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = await res.json();
          const rawCalls = Array.isArray(json.calls) ? json.calls : [];
          return rawCalls.map((c: any, index: number) => {
            const start = c.createdAt ? new Date(c.createdAt) : new Date();
            const end = c.endedAt ? new Date(c.endedAt) : (c.updatedAt ? new Date(c.updatedAt) : null);
            let durationSeconds = 0;
            if (end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
              durationSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
            }
            const mins = Math.floor(durationSeconds / 60);
            const secs = durationSeconds % 60;
            const duration = durationSeconds > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : '0m 00s';

            const timeStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isToday = new Date().toDateString() === start.toDateString();
            const dateTime = isToday ? `Today, ${timeStr}` : `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;

            const status = c.state === 'ended' || c.state === 'completed'
              ? 'Ended'
              : c.state === 'failed'
              ? 'Failed'
              : c.state === 'ringing'
              ? 'Ringing'
              : 'Active';

            return {
              id: c.id || `call_${index}_${start.getTime()}`,
              did: c.did || '—',
              direction: (c.direction === 'outbound' ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
              state: c.state || 'ended',
              status,
              duration,
              durationSeconds,
              dateTime,
              createdAt: c.createdAt || new Date().toISOString(),
              updatedAt: c.updatedAt || new Date().toISOString(),
              endedAt: c.endedAt || null,
              pbxHost: c.pbxHost || '—',
              routePointDn: c.routePointDn || '—',
              transcriptId: c.transcriptId || '',
            };
          });
        }
      } catch {
        // Fall through
      }
    }
    return [];
  }

  /**
   * Fetch background task history / queued executions.
   */
  async getTasks(limit: number = 20): Promise<TaskRecord[]> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/tasks?limit=${limit}`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const json = await res.json();
          const rawTasks = Array.isArray(json)
            ? json
            : Array.isArray(json.tasks)
              ? json.tasks
              : Array.isArray(json.data)
                ? json.data
                : [];
          return rawTasks.map((task: any) => ({
            id: task.id || task.task_id,
            title: task.title || '',
            tool_name: task.tool_name || '',
            status: task.status || 'pending',
            output_result: task.output_result,
            error_message: task.error_message,
            created_at: task.created_at,
            updated_at: task.updated_at,
          }));
        }
      } catch {
        // Fall through
      }
    }
    return [];
  }

  /**
   * Cancel an active or pending background task.
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const webBase = this.getWebBase();
    const endpoints = [`${webBase}/api/tasks/${encodeURIComponent(taskId)}`];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Accept': 'application/json', Origin: requestOrigin(webBase) },
          credentials: 'include',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return true;
        }
      } catch {
        // Fall through
      }
    }
    return false;
  }
}

export const apiService = new ApiService();
