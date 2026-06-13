/**
 * Identity server-action boundary test (T6) — the browser → Cara OTP edge.
 *
 * Proves the model-blind contract at the action layer:
 *   - verifyIdentityOtp returns ONLY { verified, opaqueRef(+method) } — grep the full result for the
 *     fixture name/DOB/phone/email → ABSENT.
 *   - requestIdentityOtp validates input and surfaces a coarse, PHI-free error.
 *   - Missing CARA_API_KEY → { error: 'not_configured' } (the live gate), never a crash.
 *
 * `@/lib/providers` is mocked so no live network is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FIXTURE_CLAIM, FIXTURE_IDENTIFIERS } from '@/lib/identity/__tests__/_fixture-claim';
import { mintOpaqueRef } from '@/lib/identity/opaque-ref';

// --- Mock the provider registry the actions depend on ---
const verifyOtp = vi.fn();
const requestOtp = vi.fn();
let providersThrows = false;

vi.mock('@/lib/providers', () => ({
  getProviders: () => {
    if (providersThrows) throw new Error('CARA_API_KEY is not set');
    return {
      comms: { vendor: 'cara' },
      ehr: { vendor: 'elation' },
      identity: { requestOtp, verifyOtp },
    };
  },
}));

import { requestIdentityOtp, verifyIdentityOtp } from '@/app/identity/actions';

beforeEach(() => {
  vi.clearAllMocks();
  providersThrows = false;
});

describe('requestIdentityOtp', () => {
  it('happy path: returns only an opaque challenge handle (no claim echoed)', async () => {
    requestOtp.mockResolvedValue({ challengeId: 'chal-1', expiresAt: '2026-06-13T12:05:00.000Z' });
    const res = await requestIdentityOtp({
      fullName: FIXTURE_CLAIM.fullName,
      dateOfBirth: FIXTURE_CLAIM.dateOfBirth,
      phone: FIXTURE_CLAIM.phone,
      channel: 'sms',
    });
    expect(res).toEqual({ ok: true, challengeId: 'chal-1', expiresAt: '2026-06-13T12:05:00.000Z' });
    // The action result carries NONE of the claim identifiers.
    const blob = JSON.stringify(res);
    for (const id of FIXTURE_IDENTIFIERS) expect(blob).not.toContain(id);
  });

  it('rejects invalid input with a coarse error (no claim leak)', async () => {
    const res = await requestIdentityOtp({ fullName: '', dateOfBirth: 'nope', channel: 'sms' });
    expect(res).toEqual({ ok: false, error: 'invalid_input' });
  });

  it('returns not_configured when CARA_API_KEY is absent (live gate)', async () => {
    providersThrows = true;
    const res = await requestIdentityOtp({
      fullName: FIXTURE_CLAIM.fullName,
      dateOfBirth: FIXTURE_CLAIM.dateOfBirth,
      phone: FIXTURE_CLAIM.phone,
      channel: 'sms',
    });
    expect(res).toEqual({ ok: false, error: 'not_configured' });
  });
});

describe('verifyIdentityOtp — returns ONLY the model-safe identity', () => {
  it('on success returns { verified, opaqueRef } and NONE of the fixture identifiers', async () => {
    const opaqueRef = mintOpaqueRef();
    verifyOtp.mockResolvedValue({ verified: true, opaqueRef, verifiedAt: '2026-06-13T12:06:00.000Z', method: 'otp' });

    const res = await verifyIdentityOtp({ challengeId: 'chal-1', code: '123456' });

    expect(res.ok).toBe(true);
    expect(res.identity).toEqual({ verified: true, opaqueRef, method: 'otp' });
    // GREP-ABSENT at the action boundary.
    const blob = JSON.stringify(res);
    for (const id of FIXTURE_IDENTIFIERS) expect(blob).not.toContain(id);
    expect(blob).toContain(opaqueRef);
    // verifiedAt is dropped by the projection (not part of model context).
    expect(blob).not.toContain('2026-06-13T12:06:00.000Z');
  });

  it('FAIL-CLOSED: a non-verified result surfaces verification_failed (no identity)', async () => {
    verifyOtp.mockResolvedValue({ verified: false, opaqueRef: '', method: 'none' });
    const res = await verifyIdentityOtp({ challengeId: 'chal-1', code: '000000' });
    expect(res).toEqual({ ok: false, error: 'verification_failed' });
  });
});
