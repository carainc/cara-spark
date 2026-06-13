import { describe, it, expect, beforeEach, vi } from 'vitest';

const registerSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/voice', () => ({ getVoiceGateway: () => ({ registerAgent: registerSpy }) }));

import { POST } from '@/app/api/voice/register/route';

function post(body: unknown): Request {
  return new Request('https://example/api/voice/register', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { agentId: 'a1', workerName: 'cara-spark-triage', configSignature: 'deadbeef' };

describe('POST /api/voice/register — SIP dispatch registration (fail-closed on tamper)', () => {
  beforeEach(() => {
    registerSpy.mockReset();
  });

  it('400 on invalid JSON', async () => {
    expect((await POST(post('{ bad'))).status).toBe(400);
  });
  it('400 on missing required fields (never registers)', async () => {
    expect((await POST(post({ agentId: 'a1' }))).status).toBe(400);
    expect(registerSpy).not.toHaveBeenCalled();
  });
  it('200 when the gateway accepts (valid signature)', async () => {
    registerSpy.mockResolvedValue({ ok: true });
    expect((await POST(post(validBody))).status).toBe(200);
  });
  it('403 when the config signature fails (tamper → dispatch refused)', async () => {
    registerSpy.mockResolvedValue({ ok: false });
    expect((await POST(post(validBody))).status).toBe(403);
  });
});
