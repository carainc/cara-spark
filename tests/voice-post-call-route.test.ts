import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mintWorkerToken } from '@/lib/voice/config-signature';

const postCallSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/voice', () => ({ getVoiceGateway: () => ({ postCallResult: postCallSpy }) }));

import { POST } from '@/app/api/voice/post-call/route';

// Arbitrary fixture string (not a credential) — only feeds the HMAC in this unit test.
const HMAC = 'test-hmac-fixture';
const CALL = 'call_pc';

function post(body: unknown, token?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example/api/voice/post-call', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { callId: CALL, agentId: 'a1', disposition: 'ROUTINE_REVIEW', trace: { traceId: 't1' } };

describe('POST /api/voice/post-call — persist final result + audit (fail-closed auth)', () => {
  beforeEach(() => {
    process.env.VOICE_CONFIG_HMAC_SECRET = HMAC;
    postCallSpy.mockReset();
  });
  afterEach(() => {
    delete process.env.VOICE_CONFIG_HMAC_SECRET;
  });

  it('400 on invalid JSON', async () => {
    expect((await POST(post('{ bad', mintWorkerToken(CALL, HMAC)))).status).toBe(400);
  });
  it('400 on missing required fields', async () => {
    expect((await POST(post({ callId: CALL }, mintWorkerToken(CALL, HMAC)))).status).toBe(400);
  });
  it('401 when the worker token is missing/invalid (never persists)', async () => {
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
    expect(postCallSpy).not.toHaveBeenCalled();
  });
  it('200 persists when authorized', async () => {
    postCallSpy.mockResolvedValue({ ok: true, callId: CALL });
    const res = await POST(post(validBody, mintWorkerToken(CALL, HMAC)));
    expect(res.status).toBe(200);
    expect(postCallSpy).toHaveBeenCalledOnce();
  });
});
