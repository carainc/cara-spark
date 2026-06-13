import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mintWorkerToken } from '@/lib/voice/config-signature';

// The deterministic engine gateway is mocked so we test the ROUTE's contract (validation, auth,
// fail-closed), not the engine itself (covered by the engine suite).
const decideSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/voice', () => ({ getVoiceGateway: () => ({ decide: decideSpy }) }));

import { POST } from '@/app/api/voice/decide/route';

// Arbitrary fixture string (not a credential) — only feeds the HMAC in this unit test.
const HMAC = 'test-hmac-fixture';
const CALL = 'call_xyz';

function post(body: unknown, token?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example/api/voice/decide', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { callId: CALL, agentId: 'agent_1', evidence: [], riskEstimate: { probability: 0.1 } };

describe('POST /api/voice/decide — no-PHI mid-call policy decision (fail-closed)', () => {
  beforeEach(() => {
    process.env.VOICE_CONFIG_HMAC_SECRET = HMAC;
    decideSpy.mockReset();
  });
  afterEach(() => {
    delete process.env.VOICE_CONFIG_HMAC_SECRET;
  });

  it('400 on invalid JSON', async () => {
    const res = await POST(post('{ not json', mintWorkerToken(CALL, HMAC)));
    expect(res.status).toBe(400);
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('400 on missing required fields', async () => {
    const res = await POST(post({ callId: CALL }, mintWorkerToken(CALL, HMAC)));
    expect(res.status).toBe(400);
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('401 when the worker token is missing/invalid (decision never reached)', async () => {
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('200 returns the engine decision when authorized', async () => {
    decideSpy.mockResolvedValue({ action: 'ED_OR_911_GUIDANCE', guidance: { en: 'x', es: 'y' } });
    const res = await POST(post(validBody, mintWorkerToken(CALL, HMAC)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: 'ED_OR_911_GUIDANCE' });
  });

  it('503 fail-closed (BLOCK_AND_HUMAN_HANDOFF) when the engine throws', async () => {
    decideSpy.mockRejectedValue(new Error('NotImplemented: adjudicate'));
    const res = await POST(post(validBody, mintWorkerToken(CALL, HMAC)));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ failClosed: 'BLOCK_AND_HUMAN_HANDOFF' });
  });
});
