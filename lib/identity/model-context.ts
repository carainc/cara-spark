/**
 * Model-context identity payload (T6, tk-0006) — the boundary the grep-absent test guards.
 *
 * This is the CANONICAL assembler for the identity portion of anything handed to the model/agent.
 * It accepts a VerifiedIdentity and returns ONLY the model-safe shape — { verified, opaqueRef }
 * plus non-PHI metadata. It is structurally impossible to pass a raw IdentityClaim through here:
 * the function takes no name/DOB/phone/email parameter at all.
 *
 * Lane D builds the full prompt/context; it MUST source the identity block from this function so
 * the model is provably blind to identifiers.
 */

import type { VerifiedIdentity } from '@/lib/identity/types';

/** The ONLY identity fields allowed into model context. No PHI, by construction. */
export interface ModelIdentityContext {
  verified: boolean;
  opaqueRef: string;
  method?: string;
}

/** Project a VerifiedIdentity down to the model-safe block. Drops verifiedAt + anything else. */
export function toModelIdentityContext(identity: VerifiedIdentity): ModelIdentityContext {
  return {
    verified: identity.verified,
    opaqueRef: identity.opaqueRef,
    method: identity.method,
  };
}
