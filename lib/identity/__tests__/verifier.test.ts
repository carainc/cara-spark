/**
 * IdentityVerifier tests (T6) — the model-blind contract. All MOCKED.
 * Covers: OTP request routes to the right destination; verify mints { verified, opaqueRef } on
 * success; FAIL-CLOSED on a false verify AND on a thrown transport error; the raw claim never
 * appears in the returned identity.
 */
import { describe, it, expect } from 'vitest';
import type { CommsProvider, SendResult } from '@/lib/providers/types';
import { CaraIdentityVerifier } from '@/lib/identity/verifier';
import { isOpaqueRef } from '@/lib/identity/opaque-ref';
import { FIXTURE_CLAIM } from './_fixture-claim';

/** A hand-rolled mock CommsProvider — records the OTP destination, scripts verify. */
function mockComms(opts: {
  verify?: { verified: boolean };
  verifyThrows?: boolean;
  requestThrows?: Error;
}): CommsProvider & { lastOtpTo?: string; lastChannel?: string } {
  const m: CommsProvider & { lastOtpTo?: string; lastChannel?: string } = {
    vendor: 'cara',
    async sendSms(): Promise<SendResult> {
      return { ok: true };
    },
    async sendEmail(): Promise<SendResult> {
      return { ok: true };
    },
    async requestOtp(to, channel) {
      if (opts.requestThrows) throw opts.requestThrows;
      m.lastOtpTo = to;
      m.lastChannel = channel;
      return { challengeId: 'chal-1', expiresAt: '2026-06-13T12:05:00.000Z' };
    },
    async verifyOtp() {
      if (opts.verifyThrows) throw new Error('transport down');
      return opts.verify ?? { verified: false };
    },
  };
  return m;
}

describe('CaraIdentityVerifier.requestOtp', () => {
  it('sends the OTP to the SMS destination from the claim', async () => {
    const comms = mockComms({});
    const v = new CaraIdentityVerifier(comms);
    const res = await v.requestOtp({ claim: FIXTURE_CLAIM, channel: 'sms' });
    expect(res.challengeId).toBe('chal-1');
    expect(comms.lastOtpTo).toBe(FIXTURE_CLAIM.phone);
    expect(comms.lastChannel).toBe('sms');
  });

  it('throws (without echoing the claim) when the channel destination is missing', async () => {
    const comms = mockComms({});
    const v = new CaraIdentityVerifier(comms);
    const noEmail = { fullName: FIXTURE_CLAIM.fullName, dateOfBirth: FIXTURE_CLAIM.dateOfBirth };
    const err: unknown = await v.requestOtp({ claim: noEmail, channel: 'email' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(FIXTURE_CLAIM.fullName);
  });
});

describe('CaraIdentityVerifier.verifyOtp — mint + fail-closed', () => {
  it('mints { verified:true, opaqueRef } on success; ref is opaque and claim-free', async () => {
    const v = new CaraIdentityVerifier(mockComms({ verify: { verified: true } }));
    const id = await v.verifyOtp({ challengeId: 'chal-1', code: '123456' });

    expect(id.verified).toBe(true);
    expect(isOpaqueRef(id.opaqueRef)).toBe(true);
    expect(id.method).toBe('otp');
    // The opaque ref must not encode any identifier from the claim.
    const blob = JSON.stringify(id);
    expect(blob).not.toContain(FIXTURE_CLAIM.fullName);
    expect(blob).not.toContain(FIXTURE_CLAIM.dateOfBirth);
    expect(blob).not.toContain(FIXTURE_CLAIM.phone!);
    expect(blob).not.toContain(FIXTURE_CLAIM.email!);
  });

  it('two successful verifications yield DIFFERENT opaque refs (no cross-call linkage)', async () => {
    const v = new CaraIdentityVerifier(mockComms({ verify: { verified: true } }));
    const a = await v.verifyOtp({ challengeId: 'c', code: '1' });
    const b = await v.verifyOtp({ challengeId: 'c', code: '1' });
    expect(a.opaqueRef).not.toBe(b.opaqueRef);
  });

  it('FAIL-CLOSED: a false proxy verify returns unverified (empty ref)', async () => {
    const v = new CaraIdentityVerifier(mockComms({ verify: { verified: false } }));
    const id = await v.verifyOtp({ challengeId: 'chal-1', code: '000000' });
    expect(id).toEqual({ verified: false, opaqueRef: '', method: 'none' });
  });

  it('FAIL-CLOSED: a thrown transport error returns unverified, never throws', async () => {
    const v = new CaraIdentityVerifier(mockComms({ verifyThrows: true }));
    const id = await v.verifyOtp({ challengeId: 'chal-1', code: '123456' });
    expect(id.verified).toBe(false);
    expect(id.opaqueRef).toBe('');
  });
});
