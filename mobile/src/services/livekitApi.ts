import type { LiveKitSessionConfig, LiveKitTokenResponse } from '../types/voiceBot';

type FetchLike = typeof fetch;
type ErrorBody = { detail?: string; error_code?: string; error_message?: string };

export class LiveKitApiError extends Error {
  public readonly status?: number;
  public readonly code?: string;

  constructor(
    message: string,
    status?: number,
    code?: string,
  ) {
    super(message);
    this.name = 'LiveKitApiError';
    this.status = status;
    this.code = code;
  }
}

function configuredTokenEndpoint(): string {
  const explicit = process.env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT?.trim();
  if (explicit) return explicit;

  // The Next.js proxy verifies the user's auth cookie and signs the trusted
  // FastAPI context server-side. The mobile bundle must never own that secret.
  const appUrl = (
    process.env.EXPO_PUBLIC_APP_URL ||
    process.env.EXPO_PUBLIC_WEB_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  return `${appUrl}/api/livekit/token`;
}

export class LiveKitApiClient {
  public readonly tokenEndpoint: string;
  private readonly timeoutMs: number;

  constructor(
    tokenEndpoint = configuredTokenEndpoint(),
    timeoutMs = 30_000,
  ) {
    this.tokenEndpoint = tokenEndpoint;
    this.timeoutMs = timeoutMs;
  }

  public buildTokenUrl(options: LiveKitSessionConfig = {}): string {
    const url = new URL(this.tokenEndpoint);
    const sessionId = options.sessionId || this.generateSessionId();
    url.searchParams.set('session_id', sessionId);
    if (options.participantName?.trim()) {
      url.searchParams.set('participant_name', options.participantName.trim());
    }
    if (options.profileVersion != null) {
      url.searchParams.set('profile_version', String(options.profileVersion));
    }
    return url.toString();
  }

  public generateSessionId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid || `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  public normalizeTokenResponse(raw: unknown): LiveKitTokenResponse {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new LiveKitApiError('The voice service returned an invalid response.');
    }
    const value = raw as Record<string, unknown>;
    if (typeof value.token !== 'string' || !value.token.trim()) {
      throw new LiveKitApiError('The voice service response did not include a token.');
    }
    if (typeof value.ws_url !== 'string' || !value.ws_url.trim()) {
      throw new LiveKitApiError('The voice service response did not include a LiveKit URL.');
    }
    return {
      token: value.token,
      wsUrl: value.ws_url,
      room: typeof value.room === 'string' ? value.room : '',
      identity: typeof value.identity === 'string' ? value.identity : '',
      sessionId:
        typeof value.session_id === 'string'
          ? value.session_id
          : typeof value.sessionId === 'string'
            ? value.sessionId
            : null,
    };
  }

  public async fetchToken(
    options: LiveKitSessionConfig = {},
    fetchFn: FetchLike = fetch,
  ): Promise<LiveKitTokenResponse> {
    const sessionId = options.sessionId || this.generateSessionId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(this.buildTokenUrl({ ...options, sessionId }), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new LiveKitApiError(`Unable to reach the voice service: ${message}`, undefined, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => null)) as ErrorBody | null;
    if (!response.ok) {
      const message =
        body?.error_message || body?.detail || `Voice session request failed with HTTP ${response.status}.`;
      const fallbackCode = response.status === 401 ? 'AUTHENTICATION_REQUIRED' : 'TOKEN_REQUEST_FAILED';
      throw new LiveKitApiError(message, response.status, body?.error_code || fallbackCode);
    }

    const normalized = this.normalizeTokenResponse(body);
    return { ...normalized, sessionId: normalized.sessionId || sessionId };
  }
}

export const liveKitApiClient = new LiveKitApiClient();
