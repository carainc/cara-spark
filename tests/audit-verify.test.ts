/**
 * T11 (CAR-2390) — the stored trace verifies against the bundle checksum (the "provable" claim).
 *
 *  - an AuditEntry produced from a trace verifies against the canonical DEFAULT_POLICY;
 *  - if the policy is TAMPERED (a rule/threshold altered), the recomputed checksum differs and
 *    verification FAILS — proving the decision was bound to the exact policy at decision time.
 *
 * Pure: reuses the engine's own checksum primitive. No DB, no network.
 */
import { describe, it, expect } from 'vitest';
import { adjudicate } from '@/engine';
import { DEFAULT_POLICY, computeBundleChecksum } from '@/engine/policy-bundle';
import type { PolicyBundle } from '@/engine/types';
import { CASES, buildEvidence, buildRisk } from '@/fixtures/cases';
import { traceToAuditEntry } from '@/lib/audit/producer';
import { verifyAuditEntry } from '@/lib/audit/verify';

function infantFeverEntry() {
  const c = CASES.find((x) => x.id === 'infant-fever-en')!;
  const trace = adjudicate({ evidence: buildEvidence(c), riskEstimate: buildRisk(c), bundle: DEFAULT_POLICY });
  return traceToAuditEntry(trace, 0, DEFAULT_POLICY);
}

describe('verifyAuditEntry — provable against the bundle checksum', () => {
  it('verifies a stored entry against the canonical policy bundle', () => {
    const entry = infantFeverEntry();
    const v = verifyAuditEntry(entry, DEFAULT_POLICY);
    expect(v.verified).toBe(true);
    expect(v.checksumMatches).toBe(true);
    expect(v.bundleSelfConsistent).toBe(true);
    expect(v.versionMatches).toBe(true);
    expect(v.storedChecksum).toBe(v.recomputedChecksum);
    expect(v.reasons).toHaveLength(0);
  });

  it('FAILS verification when a rule threshold is tampered after the decision', () => {
    const entry = infantFeverEntry(); // recorded under the real DEFAULT_POLICY

    // tamper: lower the infant-fever temperature floor. Same metadata version, different content.
    const tampered: PolicyBundle = {
      ...DEFAULT_POLICY,
      redFlagRules: DEFAULT_POLICY.redFlagRules.map((r) =>
        r.id === 'infant-fever-floor'
          ? { ...r, conditions: r.conditions.map((c) => (c.factType === 'vital_temperature' ? { ...c, value: 99 } : c)) }
          : r,
      ),
    };
    // give it a fresh (matching) metadata checksum so the bundle is self-consistent...
    const tamperedConsistent: PolicyBundle = {
      ...tampered,
      metadata: { ...tampered.metadata, checksum: computeBundleChecksum(tampered) },
    };

    const v = verifyAuditEntry(entry, tamperedConsistent);
    // the bundle is internally consistent, but it is NOT the policy the entry was decided under
    expect(v.bundleSelfConsistent).toBe(true);
    expect(v.checksumMatches).toBe(false);
    expect(v.verified).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/altered/i);
  });

  it('FAILS when the bundle itself is internally inconsistent (metadata checksum wrong)', () => {
    const entry = infantFeverEntry();
    const broken: PolicyBundle = {
      ...DEFAULT_POLICY,
      metadata: { ...DEFAULT_POLICY.metadata, checksum: 'deadbeef' },
    };
    const v = verifyAuditEntry(entry, broken);
    expect(v.bundleSelfConsistent).toBe(false);
    expect(v.verified).toBe(false);
  });

  it('FAILS on a version mismatch', () => {
    const entry = { bundleVersion: '9.9.9', bundleChecksum: DEFAULT_POLICY.metadata.checksum };
    const v = verifyAuditEntry(entry, DEFAULT_POLICY);
    expect(v.versionMatches).toBe(false);
    expect(v.verified).toBe(false);
  });
});
