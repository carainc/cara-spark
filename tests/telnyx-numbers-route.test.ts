/**
 * POST /api/admin/numbers (tk-0024) — the admin provisioning route.
 *
 *   • 401 when unauthenticated; 403 for a non-admin (EDITOR) — provisioning is ADMIN+.
 *   • "search" → 200 with dry-run numbers.
 *   • "request" → 202 (Accepted) with a requires_approval request — nothing bought.
 *   • a missing TELNYX_API_KEY surfaces a clean 502 gate (never a crash, never the key).
 *   • unknown / malformed actions are rejected.
 *
 * auth() and the provisioner are mocked — no real session, no network, no spend.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authSpy = vi.hoisted(() => vi.fn());
const getProvisionerSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authSpy }));
// Mock the provisioner factory ONLY; keep the real service + TelnyxConfigError (real role gate).
vi.mock('@/lib/telnyx', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/telnyx')>();
  return { ...actual, getNumberProvisioner: getProvisionerSpy };
});

import { POST } from '@/app/api/admin/numbers/route';
import { TelnyxConfigError, type NumberProvisioner } from '@/lib/telnyx';

function post(body: unknown): Request {
  return new Request('https://example/api/admin/numbers', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function fakeProvisioner(over: Partial<NumberProvisioner> = {}): NumberProvisioner {
  return {
    vendor: 'telnyx',
    searchAvailable: vi.fn(async () => [
      { phoneNumber: '+14155550123', region: 'San Francisco', monthlyCost: '1.00', currency: 'USD' },
    ]),
    // If the route ever reached orderNumber, this would throw the test red.
    orderNumber: vi.fn(async () => {
      throw new Error('route must never call orderNumber');
    }),
    ...over,
  };
}

const ADMIN_SESSION = { user: { id: 'u-admin', role: 'ADMIN' } };
const EDITOR_SESSION = { user: { id: 'u-editor', role: 'EDITOR' } };

describe('POST /api/admin/numbers — auth gate', () => {
  beforeEach(() => {
    authSpy.mockReset();
    getProvisionerSpy.mockReset();
    getProvisionerSpy.mockReturnValue(fakeProvisioner());
  });

  it('401 when unauthenticated', async () => {
    authSpy.mockResolvedValue(null);
    expect((await POST(post({ action: 'search' }))).status).toBe(401);
  });

  it('403 for a non-admin (EDITOR)', async () => {
    authSpy.mockResolvedValue(EDITOR_SESSION);
    expect((await POST(post({ action: 'search' }))).status).toBe(403);
  });
});

describe('POST /api/admin/numbers — actions', () => {
  beforeEach(() => {
    authSpy.mockReset();
    authSpy.mockResolvedValue(ADMIN_SESSION);
    getProvisionerSpy.mockReset();
    getProvisionerSpy.mockReturnValue(fakeProvisioner());
  });

  it('search → 200 with dry-run numbers', async () => {
    const res = await POST(post({ action: 'search', areaCode: '415' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; numbers: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.numbers).toHaveLength(1);
  });

  it('request → 202 Accepted with a requires_approval request (nothing bought)', async () => {
    const res = await POST(post({ action: 'request', phoneNumber: '+14155550123' }));
    expect(res.status).toBe(202);
    const json = (await res.json()) as { ok: boolean; request: { status: string; candidate: unknown } };
    expect(json.ok).toBe(true);
    expect(json.request.status).toBe('requires_approval');
    expect(json.request.candidate).toEqual({ phoneNumber: '+14155550123' });
  });

  it('request without phoneNumber → 400', async () => {
    expect((await POST(post({ action: 'request' }))).status).toBe(400);
  });

  it('unknown action → 400', async () => {
    expect((await POST(post({ action: 'buy', phoneNumber: '+14155550123' }))).status).toBe(400);
  });

  it('invalid JSON → 400', async () => {
    expect((await POST(post('{ bad'))).status).toBe(400);
  });

  it('missing TELNYX_API_KEY → 502 gate (clean, no key)', async () => {
    getProvisionerSpy.mockImplementation(() => {
      throw new TelnyxConfigError('TELNYX_API_KEY is not set (env only — never commit it).');
    });
    const res = await POST(post({ action: 'search' }));
    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.error).toMatch(/TELNYX_API_KEY/);
  });
});
