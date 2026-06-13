/**
 * THE load-bearing safety test (T6): assemble the model-context identity payload from a verified
 * identity, then GREP the serialized payload for the fixture name / DOB / phone / email → ABSENT.
 *
 * This is the structural proof of OSS law §3 (model-blind identity): no identifier, ever, reaches
 * model context. If a future change lets a claim leak into the model block, this test goes RED.
 */
import { describe, it, expect } from 'vitest';
import { CaraIdentityVerifier } from '@/lib/identity/verifier';
import { toModelIdentityContext } from '@/lib/identity/model-context';
import type { CommsProvider, SendResult } from '@/lib/providers/types';
import type { VerifiedIdentity } from '@/lib/identity/types';
import { FIXTURE_CLAIM, FIXTURE_IDENTIFIERS } from './_fixture-claim';

function verifyingComms(): CommsProvider {
  return {
    vendor: 'cara',
    async sendSms(): Promise<SendResult> {
      return { ok: true };
    },
    async sendEmail(): Promise<SendResult> {
      return { ok: true };
    },
    async requestOtp() {
      return { challengeId: 'chal-1', expiresAt: '2026-06-13T12:05:00.000Z' };
    },
    async verifyOtp() {
      return { verified: true };
    },
  };
}

describe('model-blindness — grep the assembled model-context payload', () => {
  it('the verified identity → model context contains NONE of the fixture identifiers', async () => {
    const verifier = new CaraIdentityVerifier(verifyingComms());

    // Drive the REAL out-of-band flow with the fixture claim.
    await verifier.requestOtp({ claim: FIXTURE_CLAIM, channel: 'sms' });
    const verified = await verifier.verifyOtp({ challengeId: 'chal-1', code: '123456' });

    // Assemble exactly what crosses to the model.
    const modelContext = toModelIdentityContext(verified);

    // Simulate the broader model payload Lane D builds around the identity block.
    const assembledModelPayload = JSON.stringify({
      systemHint: 'triage agent context',
      identity: modelContext,
      // (evidence/risk would also live here — all non-PHI by contract)
    });

    expect(verified.verified).toBe(true);
    expect(modelContext.opaqueRef.length).toBeGreaterThan(0);

    // GREP-ABSENT: not one identifier may appear in the model-bound payload.
    for (const identifier of FIXTURE_IDENTIFIERS) {
      expect(assembledModelPayload).not.toContain(identifier);
    }

    // Positive control: the opaque ref IS present (so we're testing a real payload, not an empty one).
    expect(assembledModelPayload).toContain(modelContext.opaqueRef);
  });

  it('toModelIdentityContext cannot carry PHI — it only projects { verified, opaqueRef, method }', () => {
    // Even if a caller hands a (contract-violating) identity with extra fields, the projection drops
    // them. We cast through unknown to simulate a polluted object reaching the boundary.
    const dirty = {
      verified: true,
      opaqueRef: 'idr_safe',
      method: 'otp' as const,
      fullName: FIXTURE_CLAIM.fullName,
      dateOfBirth: FIXTURE_CLAIM.dateOfBirth,
    } as unknown as VerifiedIdentity;
    const projected = toModelIdentityContext(dirty);
    const blob = JSON.stringify(projected);
    expect(Object.keys(projected).sort()).toEqual(['method', 'opaqueRef', 'verified']);
    for (const identifier of FIXTURE_IDENTIFIERS) {
      expect(blob).not.toContain(identifier);
    }
  });
});
