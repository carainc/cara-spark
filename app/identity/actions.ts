'use server';

/**
 * Identity server actions (T6, tk-0006) — the browser → Cara OTP boundary.
 *
 * The raw name + DOB are captured in the browser and submitted DIRECTLY to these server actions.
 * They NEVER pass through the model. `requestOtp` returns only an opaque { challengeId, expiresAt };
 * `verifyOtp` returns only the model-safe { verified, opaqueRef }. The raw claim is held in a
 * server-side-only store (lib/identity/claim-store) keyed by challengeId and is never logged, never
 * returned to the client, never placed in model context.
 *
 * FAIL-CLOSED: a missing CARA_API_KEY (live gate) or any verify failure yields a safe negative
 * result, not a crash and not a verified identity.
 */

import { z } from 'zod';
import { getProviders } from '@/lib/providers';
import type { IdentityClaim } from '@/lib/identity/types';
import { putPendingClaim, consumePendingClaim } from '@/lib/identity/claim-store';
import { OtpRateLimitedError } from '@/lib/cara';
import type { ModelIdentityContext } from '@/lib/identity/model-context';
import { toModelIdentityContext } from '@/lib/identity/model-context';

// --- Validation (server-side; the claim never leaves the server) ---
const claimSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO yyyy-mm-dd.'),
    phone: z.string().trim().min(3).max(32).optional(),
    email: z.string().trim().email().max(254).optional(),
    channel: z.enum(['sms', 'email']),
  })
  .refine((v) => (v.channel === 'sms' ? !!v.phone : !!v.email), {
    message: 'A destination matching the chosen channel is required.',
  });

export interface RequestOtpResult {
  ok: boolean;
  challengeId?: string;
  expiresAt?: string;
  /** Coarse, PHI-free reason for the UI. Never includes the destination or the claim. */
  error?: 'invalid_input' | 'not_configured' | 'rate_limited' | 'send_failed';
}

export interface VerifyOtpResult {
  ok: boolean;
  /** The ONLY identity shape that may cross to the model/agent. */
  identity?: ModelIdentityContext;
  error?: 'invalid_input' | 'not_configured' | 'verification_failed';
}

/**
 * Step 1 — capture the claim server-side, send an OTP via the Cara comms provider, and return only
 * the opaque challenge handle. The claim is stashed server-side under challengeId for step 2.
 */
export async function requestIdentityOtp(input: unknown): Promise<RequestOtpResult> {
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const { channel, ...rest } = parsed.data;
  const claim: IdentityClaim = {
    fullName: rest.fullName,
    dateOfBirth: rest.dateOfBirth,
    phone: rest.phone,
    email: rest.email,
  };

  let providers;
  try {
    providers = getProviders();
  } catch {
    // CARA_API_KEY / CARA_TENANT_ID not set — the live gate. Surface it without leaking anything.
    return { ok: false, error: 'not_configured' };
  }

  try {
    const { identity } = providers;
    const res = await identity.requestOtp({ claim, channel });
    putPendingClaim(res.challengeId, claim);
    return { ok: true, challengeId: res.challengeId, expiresAt: res.expiresAt };
  } catch (err) {
    if (err instanceof OtpRateLimitedError) return { ok: false, error: 'rate_limited' };
    return { ok: false, error: 'send_failed' };
  }
}

const verifySchema = z.object({
  challengeId: z.string().trim().min(1).max(256),
  code: z.string().trim().min(4).max(12),
});

/**
 * Step 2 — verify the code and mint the model-safe identity. FAIL-CLOSED: anything other than an
 * explicit success returns a non-verified result. The pending claim is consumed (single-use) so a
 * verify can't be replayed; the claim is never returned.
 */
export async function verifyIdentityOtp(input: unknown): Promise<VerifyOtpResult> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  let providers;
  try {
    providers = getProviders();
  } catch {
    return { ok: false, error: 'not_configured' };
  }

  // Consume the pending claim (single-use). Its presence is required, but it is NEVER returned.
  consumePendingClaim(parsed.data.challengeId);

  const identity = await providers.identity.verifyOtp({
    challengeId: parsed.data.challengeId,
    code: parsed.data.code,
  });

  if (!identity.verified) {
    return { ok: false, error: 'verification_failed' };
  }

  // Project down to the model-safe block before it can ever reach a client/model.
  return { ok: true, identity: toModelIdentityContext(identity) };
}
