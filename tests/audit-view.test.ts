/**
 * T11 — audit READ-side view model. The per-call trail viewer binds directly to toCallTrailView,
 * so this asserts what the UI highlights: the infant-fever step is an intervention carrying the
 * firing rule id + canned action, model-proposed ≠ engine-decided, and the step verifies against
 * the bundle checksum. Pure: no DB/React. Stored rows are produced by the real producer mapping.
 */
import { describe, it, expect } from 'vitest';
import { adjudicate } from '@/engine';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';
import { CASES, buildEvidence, buildRisk } from '@/fixtures/cases';
import { traceToAuditEntry } from '@/lib/audit/producer';
import { toCallTrailView, toStepView, type StoredAuditEntry } from '@/lib/audit/view';

/** Build a stored-row (the shape Prisma hands back) from a fixture, via the real producer mapping. */
function storedRow(caseId: string, seq: number): StoredAuditEntry {
  const c = CASES.find((x) => x.id === caseId)!;
  const trace = adjudicate({ evidence: buildEvidence(c), riskEstimate: buildRisk(c), bundle: DEFAULT_POLICY });
  const row = traceToAuditEntry(trace, seq, DEFAULT_POLICY);
  return {
    id: `ae-${caseId}-${seq}`,
    seq: row.seq,
    evidenceJson: row.evidenceJson,
    redFlagJson: row.redFlagJson,
    riskJson: row.riskJson,
    decisionJson: row.decisionJson,
    bundleVersion: row.bundleVersion,
    bundleChecksum: row.bundleChecksum,
    intervention: row.intervention,
    ruleIdsFired: row.ruleIdsFired,
  };
}

describe('toStepView — infant-fever intervention is render-ready and highlighted', () => {
  const step = toStepView(storedRow('infant-fever-en', 0), DEFAULT_POLICY);

  it('marks the step as an intervention with the red-flag kind', () => {
    expect(step.intervention).toBe(true);
    expect(step.interventionKinds).toContain('red_flag_escalation');
    expect(step.interventionKinds).toContain('engine_overruled_model');
  });

  it('exposes the firing rule id + canned action for the highlight', () => {
    expect(step.ruleIdsFired).toContain('infant-fever-floor');
    const hit = step.redFlagResult.hits.find((h) => h.ruleId === 'infant-fever-floor');
    expect(hit?.action).toBe('ED_OR_911_GUIDANCE');
  });

  it('shows model-proposed ≠ engine-decided', () => {
    expect(step.engineAction).toBe('ED_OR_911_GUIDANCE');
    expect(step.modelProposedAction).not.toBe('ED_OR_911_GUIDANCE');
  });

  it('verifies the step checksum against the bundle', () => {
    expect(step.checksumVerified).toBe(true);
  });
});

describe('toCallTrailView — aggregate over a multi-step call', () => {
  it('counts interventions and reports all-verified across steps', () => {
    const trail = toCallTrailView([storedRow('common-cold-en', 0), storedRow('infant-fever-en', 1)], DEFAULT_POLICY);
    expect(trail.steps.map((s) => s.seq)).toEqual([0, 1]);
    expect(trail.interventionCount).toBe(1);
    expect(trail.allVerified).toBe(true);
  });

  it('sorts steps by seq even when rows arrive out of order', () => {
    const trail = toCallTrailView([storedRow('infant-fever-en', 2), storedRow('common-cold-en', 0)], DEFAULT_POLICY);
    expect(trail.steps.map((s) => s.seq)).toEqual([0, 2]);
  });

  it('reports allVerified=null when no bundle is supplied (not re-verifiable here)', () => {
    const trail = toCallTrailView([storedRow('infant-fever-en', 0)]);
    expect(trail.allVerified).toBeNull();
    expect(trail.steps[0].checksumVerified).toBeNull();
    // intervention flag still surfaces from the stored row
    expect(trail.steps[0].intervention).toBe(true);
  });
});
