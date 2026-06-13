/**
 * Audit verification (T11) — the "provable, replayable" half of the audit trail.
 *
 * A stored AuditEntry records `bundleVersion` + `bundleChecksum` at decision time. This module
 * re-derives the checksum from the bundle the engine ran and confirms it matches what was stored —
 * so anyone (a judge, an auditor) can prove the decision was made against THAT exact, untampered
 * policy. If a rule or threshold had been altered, `computeBundleChecksum` would differ and
 * verification fails.
 *
 * Pure — reuses the engine's own checksum primitive (no re-implementation). No DB, no AI.
 */
import type { PolicyBundle } from '@/engine/types';
import { computeBundleChecksum, verifyPolicyBundle } from '@/engine/policy-bundle';

/** The subset of an AuditEntry needed to verify it (what the viewer reads from the DB). */
export interface VerifiableAuditEntry {
  bundleVersion: string;
  bundleChecksum: string;
}

export interface AuditVerification {
  /** Stored checksum equals the checksum recomputed from the provided bundle. */
  checksumMatches: boolean;
  /** The provided bundle is internally consistent (its own metadata checksum is valid). */
  bundleSelfConsistent: boolean;
  /** Stored bundleVersion equals the provided bundle's version. */
  versionMatches: boolean;
  /** All three of the above. The decision is provable against this bundle. */
  verified: boolean;
  storedChecksum: string;
  recomputedChecksum: string;
  reasons: string[];
}

/**
 * Verify a stored audit entry against the canonical policy bundle it claims to have run under.
 * The bundle is supplied by the caller (e.g. the agent's pinned bundle version) — we never trust
 * the stored checksum alone; we RECOMPUTE from the bundle content.
 */
export function verifyAuditEntry(
  entry: VerifiableAuditEntry,
  bundle: PolicyBundle,
): AuditVerification {
  const reasons: string[] = [];

  const recomputedChecksum = computeBundleChecksum(bundle);
  const checksumMatches = entry.bundleChecksum === recomputedChecksum;
  if (!checksumMatches) {
    reasons.push(
      `Stored checksum does not match the bundle: the policy may have been altered after this decision.`,
    );
  }

  const self = verifyPolicyBundle(bundle);
  const bundleSelfConsistent = self.valid;
  if (!bundleSelfConsistent) {
    reasons.push(`Bundle is internally inconsistent: ${self.errors.join('; ')}`);
  }

  const versionMatches = entry.bundleVersion === bundle.metadata.policyVersion;
  if (!versionMatches) {
    reasons.push(
      `Version mismatch: entry recorded ${entry.bundleVersion}, bundle is ${bundle.metadata.policyVersion}.`,
    );
  }

  const verified = checksumMatches && bundleSelfConsistent && versionMatches;
  return {
    checksumMatches,
    bundleSelfConsistent,
    versionMatches,
    verified,
    storedChecksum: entry.bundleChecksum,
    recomputedChecksum,
    reasons,
  };
}
