import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the routing module (the lookup is unit-tested in voice-routing.test.ts) and the auth guard.
const resolveSpy = vi.hoisted(() => vi.fn());
const authSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/voice/routing', () => ({
  resolveAgentByDid: resolveSpy,
  // pass-through projection so the route's breadcrumb call is harmless in the test
  safeRoutingLog: (r: unknown) => r,
}));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('../app/api/voice/_auth', () => ({ authorizeWorker: authSpy }));
// The route imports `../_auth` relative to itself → resolves to app/api/voice/_auth.
vi.mock('@/app/api/voice/_auth', () => ({ authorizeWorker: authSpy }));

import { POST } from '@/app/api/voice/inbound/route';

// `authorizeWorker` is fully mocked (the `authSpy` decides authz), so the route never reads an
// Authorization header here — we send none, which also keeps any token-shaped literal out of the
// test. The unauthorized path is covered explicitly via `authSpy.mockReturnValue(false)`.
function post(body: unknown): Request {
  return new Request('https://example/api/voice/inbound', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const matched = {
  matched: true as const,
  agentId: 'agent_1',
  agentName: 'After-hours Triage',
  language: 'en',
  workerName: 'cara-spark-after-hours-triage',
  dispatchName: 'cara-spark-after-hours-triage',
  plan: {
    workerName: 'cara-spark-after-hours-triage',
    roomPrefix: 'voicephone-agent_1-',
    attributes: { agentId: 'agent_1', agentName: 'After-hours Triage', language: 'en' },
  },
};

describe('POST /api/voice/inbound — DID → agent dispatch (fail-closed)', () => {
  beforeEach(() => {
    resolveSpy.mockReset();
    authSpy.mockReset();
    authSpy.mockReturnValue(true); // authorized by default; overridden per-test
  });

  it('400 on invalid JSON (never resolves)', async () => {
    expect((await POST(post('{ bad'))).status).toBe(400);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('400 when no call/session id is present (token cannot be bound)', async () => {
    const res = await POST(post({ to: '+14157180498' }));
    expect(res.status).toBe(400);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('401 when the worker token is unauthorized (before any lookup)', async () => {
    authSpy.mockReturnValue(false);
    const res = await POST(post({ callId: 'c1', to: '+14157180498' }));
    expect(res.status).toBe(401);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('200 + dispatch plan when the dialed DID resolves to a published agent', async () => {
    resolveSpy.mockResolvedValue(matched);
    const res = await POST(post({ callId: 'c1', to: '+14157180498' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      matched: true,
      agentId: 'agent_1',
      workerName: 'cara-spark-after-hours-triage',
      dispatchName: 'cara-spark-after-hours-triage',
      roomPrefix: 'voicephone-agent_1-',
      attributes: { agentId: 'agent_1', agentName: 'After-hours Triage', language: 'en' },
    });
  });

  it('reads the dialed DID from a Telnyx-style nested payload', async () => {
    resolveSpy.mockResolvedValue(matched);
    await POST(post({ call_control_id: 'cc1', data: { payload: { to: '+14157180498' } } }));
    expect(resolveSpy).toHaveBeenCalledWith({}, '+14157180498');
  });

  it('404 + NO dispatch plan when no agent owns the DID (fail closed, never mis-route)', async () => {
    resolveSpy.mockResolvedValue({ matched: false, reason: 'no_match' });
    const res = await POST(post({ callId: 'c1', to: '+19998887777' }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ matched: false, reason: 'no_match' });
    expect(json.workerName).toBeUndefined();
    expect(json.dispatchName).toBeUndefined();
  });

  it('404 when two agents claim the DID (ambiguous → refuse, never guess)', async () => {
    resolveSpy.mockResolvedValue({ matched: false, reason: 'ambiguous' });
    expect((await POST(post({ callId: 'c1', to: '+14157186666' }))).status).toBe(404);
  });

  it('400 when the payload carried no usable DID', async () => {
    resolveSpy.mockResolvedValue({ matched: false, reason: 'no_did' });
    const res = await POST(post({ callId: 'c1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe('no_did');
  });
});
