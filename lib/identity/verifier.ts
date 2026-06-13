/**
 * Identity verifier (T6, tk-0006) — the model-blind `IdentityVerifier` impl
 * (lib/identity/types.ts, FROZEN). THE SAFETY FLEX.
 *
 * Flow: a raw IdentityClaim (name + DOB [+ phone/email]) is captured OUT-OF-BAND (browser →
 * server action → Cara OTP). This verifier:
 *   1. requestOtp  — sends the OTP over the claim's channel (raw destination → comms provider only).
 *   2. verifyOtp   — on success, mints a fresh OPAQUE ref and returns { verified, opaqueRef }.
 *
 * INVARIANTS (load-bearing, asserted by tests):
 *   - The raw claim NEVER appears in the returned VerifiedIdentity (no name/DOB/phone/email).
 *   - The opaqueRef is CSPRNG-random, derived from nothing in the claim (lib/identity/opaque-ref).
 *   - FAIL-CLOSED: any verify failure / error → unverifiedIdentity() ({ verified:false }).
 *   - Nothing here logs the claim, the destination, or the OTP code.
 */

import type {
  CommsProvider,
} from '@/lib/providers/types';
import {
  type IdentityVerifier,
  type OtpRequest,
  type OtpRequestResult,
  type OtpVerifyRequest,
  type VerifiedIdentity,
  unverifiedIdentity,
} from '@/lib/identity/types';
import { mintOpaqueRef } from './opaque-ref';

export class CaraIdentityVerifier implements IdentityVerifier {
  private readonly comms: CommsProvider;

  constructor(comms: CommsProvider) {
    this.comms = comms;
  }

  /**
   * Step 1 — request an OTP for the claim. We pull the destination from the claim's channel and
   * hand ONLY that destination to the comms provider. The full claim is not persisted here and is
   * never logged. (The server caller is responsible for stashing the claim in its own secure,
   * short-lived store keyed by challengeId — never in model context.)
   */
  async requestOtp(req: OtpRequest): Promise<OtpRequestResult> {
    const destination = req.channel === 'sms' ? req.claim.phone : req.claim.email;
    if (!destination) {
      // Don't echo the claim — just name the missing field generically.
      throw new Error(`Identity claim is missing a ${req.channel} destination.`);
    }
    return this.comms.requestOtp(destination, req.channel);
  }

  /**
   * Step 2 — verify the code and mint the model-safe identity. FAIL-CLOSED on any failure: a false
   * verify, a thrown transport error, or anything other than an explicit success returns
   * unverifiedIdentity(). On success we mint a FRESH opaque ref (no claim input).
   */
  async verifyOtp(req: OtpVerifyRequest): Promise<VerifiedIdentity> {
    let result: { verified: boolean };
    try {
      result = await this.comms.verifyOtp(req.challengeId, req.code);
    } catch {
      return unverifiedIdentity();
    }

    if (!result.verified) {
      return unverifiedIdentity();
    }

    return {
      verified: true,
      opaqueRef: mintOpaqueRef(),
      verifiedAt: new Date().toISOString(),
      method: 'otp',
    };
  }
}
