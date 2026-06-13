/**
 * Model-blind identity barrel (T6, tk-0006). Lane D imports the verifier + the FROZEN
 * { verified, opaqueRef } types from here. The raw IdentityClaim type also lives in ./types but
 * MUST stay server-side — never construct it inside model context.
 */

export * from './types';
export { mintOpaqueRef, isOpaqueRef, OPAQUE_REF_PREFIX } from './opaque-ref';
export { CaraIdentityVerifier } from './verifier';
export { toModelIdentityContext, type ModelIdentityContext } from './model-context';

import type { CommsProvider } from '@/lib/providers/types';
import type { IdentityVerifier } from './types';
import { CaraIdentityVerifier } from './verifier';

/** Build the default (Cara-backed) identity verifier from a comms provider. */
export function createIdentityVerifier(comms: CommsProvider): IdentityVerifier {
  return new CaraIdentityVerifier(comms);
}
