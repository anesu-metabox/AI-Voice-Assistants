import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LiveKitApiClient, LiveKitApiError } from '../src/services/livekitApi.ts';

describe('LiveKitApiClient production contract', () => {
  it('targets the authenticated proxy with backend-supported query parameters', () => {
    const client = new LiveKitApiClient('https://app.example.com/api/livekit/token');
    const url = new URL(client.buildTokenUrl({
      sessionId: 'mobile-session-123',
      participantName: 'Mobile User',
      profileVersion: 4,
    }));

    assert.equal(url.origin, 'https://app.example.com');
    assert.equal(url.pathname, '/api/livekit/token');
    assert.equal(url.searchParams.get('session_id'), 'mobile-session-123');
    assert.equal(url.searchParams.get('participant_name'), 'Mobile User');
    assert.equal(url.searchParams.get('profile_version'), '4');
  });

  it('includes auth cookies but never fabricates the trusted HMAC header', async () => {
    const client = new LiveKitApiClient('https://app.example.com/api/livekit/token');
    let requestInit: RequestInit | undefined;
    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init;
      return new Response(JSON.stringify({
        token: 'signed-token',
        ws_url: 'wss://voice.livekit.cloud',
        room: 'sandbox-mobile-session-123',
        identity: 'user-123',
        session_id: 'mobile-session-123',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const token = await client.fetchToken({ sessionId: 'mobile-session-123' }, fetchMock as typeof fetch);
    const headers = requestInit?.headers as Record<string, string>;
    assert.equal(requestInit?.credentials, 'include');
    assert.equal(headers.Accept, 'application/json');
    assert.equal(headers['X-Verified-Session-Context'], undefined);
    assert.equal(token.wsUrl, 'wss://voice.livekit.cloud');
    assert.equal(token.sessionId, 'mobile-session-123');
  });

  it('preserves the proxy error code and message for the UI', async () => {
    const client = new LiveKitApiClient('https://app.example.com/api/livekit/token');
    const fetchMock = async () => new Response(JSON.stringify({
      error_code: 'AUTHENTICATION_REQUIRED',
      error_message: 'Sign in is required.',
    }), { status: 401, headers: { 'content-type': 'application/json' } });

    await assert.rejects(
      client.fetchToken({ sessionId: 'mobile-session-123' }, fetchMock as typeof fetch),
      (error: unknown) => {
        assert.ok(error instanceof LiveKitApiError);
        assert.equal(error.status, 401);
        assert.equal(error.code, 'AUTHENTICATION_REQUIRED');
        assert.equal(error.message, 'Sign in is required.');
        return true;
      },
    );
  });
});
