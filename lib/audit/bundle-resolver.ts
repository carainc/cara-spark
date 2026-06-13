/**
 * Resolve the PolicyBundle for a recorded `bundleVersion` so the audit viewer can RE-VERIFY a stored
 * decision's checksum (T11). Reads through the ENGINE'S bundle registry (tk-0025), which ships the
 * hand-authored DEFAULT_POLICY plus the signed familymed-v1 bundle.
 *
 * The recorded version is the bundle's INTERNAL `metadata.policyVersion` (what the trace carries —
 * '1.0.0' for the default, 'familymed-v1' for familymed), which for familymed equals its DB version
 * string. We resolve by either key: first the registry's DB version, then a scan by internal
 * policyVersion (so the default's '1.0.0' still resolves). Unknown → null, and the viewer shows
 * "checksum not re-verifiable here" rather than a false PASS.
 */
import type { PolicyBundle } from '@/engine/types';
import { DEFAULT_POLICY, getRegisteredBundle, listRegisteredBundles } from '@/engine';

export function resolveBundle(version: string): PolicyBundle | null {
  if (!version) return null;
  // Fast path: the DEFAULT's internal policyVersion ('1.0.0') resolves to the exact DEFAULT_POLICY
  // object — keeping referential identity that the audit re-verify test asserts.
  if (version === DEFAULT_POLICY.metadata.policyVersion) return DEFAULT_POLICY;
  // Registry by DB version string (e.g. 'familymed-v1', 'default-0.1.0').
  const byVersion = getRegisteredBundle(version);
  if (byVersion) return byVersion;
  // Fall back to a scan by each registered bundle's INTERNAL policyVersion.
  for (const entry of listRegisteredBundles()) {
    const bundle = entry.build();
    if (bundle.metadata.policyVersion === version) return bundle;
  }
  return null;
}
