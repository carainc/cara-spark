/**
 * Resolve the PolicyBundle for a recorded `bundleVersion` so the audit viewer can RE-VERIFY a stored
 * decision's checksum (T11). The OSS build ships the hand-authored DEFAULT_POLICY; custom signed
 * bundles are owned by Lane B / T2 (CAR-2363), which will register them in a bundle store.
 *
 * INTEGRATION SEAM (flagged, not silently assumed): when T2's bundle store lands, swap this for a
 * lookup by version. Until then, a recorded version that matches the default resolves to
 * DEFAULT_POLICY; anything else returns null (the viewer then shows "checksum not re-verifiable
 * here" rather than a false PASS).
 */
import type { PolicyBundle } from '@/engine/types';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';

export function resolveBundle(version: string): PolicyBundle | null {
  if (version === DEFAULT_POLICY.metadata.policyVersion) return DEFAULT_POLICY;
  // Custom signed bundles (Lane B / T2's bundle store) resolve by version once that store lands;
  // until then an unknown version returns null and the viewer shows "not re-verifiable here".
  return null;
}
