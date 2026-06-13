/**
 * Opaque reference minting (T6, tk-0006) — the heart of model-blind identity.
 *
 * The `opaqueRef` is the ONLY identity handle the model/agent ever sees (lib/identity/types.ts,
 * FROZEN). It MUST encode NO PHI: no name, DOB, phone, email, or MRN — not even encoded/hashed,
 * because a stable hash of an identifier is still a re-identification vector across calls.
 *
 * So we mint a fresh, cryptographically-random token with NO input from the claim. The mapping
 * from opaqueRef → server-side record lives server-side only (out of scope here / Lane F's store).
 */

import { randomBytes } from 'node:crypto';

/** Human-skimmable namespace so logs/audit can tell an identity ref apart — carries no PHI. */
export const OPAQUE_REF_PREFIX = 'idr_';

/**
 * Mint a fresh opaque identity reference. Derived from CSPRNG bytes ONLY — never from the claim,
 * so two verifications of the same person yield different refs (no cross-call linkage via the ref).
 */
export function mintOpaqueRef(): string {
  return `${OPAQUE_REF_PREFIX}${randomBytes(24).toString('base64url')}`;
}

/** Shape check only (prefix + non-trivial length). Does NOT decode anything — there's nothing to decode. */
export function isOpaqueRef(value: string): boolean {
  return typeof value === 'string' && value.startsWith(OPAQUE_REF_PREFIX) && value.length > OPAQUE_REF_PREFIX.length + 16;
}
