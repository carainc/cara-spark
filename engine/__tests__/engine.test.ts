/**
 * T1 mandatory suite (runbook Lane B + port spec §4). Locks: finite AllowedAction, red-flag
 * dominance, fail-closed, the 12-check inference gate, checksum stable/version-bump/tamper-rejected,
 * forward-only workflow, plus the red-flag operator + risk behaviors carried from VA-5.
 */
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_ACTIONS,
  ACTION_SEVERITY,
  adjudicate,
  advance,
  canTransition,
  computeBundleChecksum,
  computeConfidence,
  createPolicyBundle,
  decide,
  DEFAULT_POLICY,
  DEFAULT_URGENCY_THRESHOLDS,
  estimateRisk,
  evaluateRedFlags,
  runInferenceCheck,
  verifyPolicyBundle,
} from '@/engine';
import type { EvidenceFact, RiskEstimate } from '@/engine/types';

const TS = '2026-06-13T12:00:00.000Z';
function fact(p: Partial<EvidenceFact> & Pick<EvidenceFact, 'factType' | 'value'>): EvidenceFact {
  return {
    id: p.id ?? `${p.factType}-${String(p.value)}`,
    factType: p.factType,
    value: p.value,
    confidence: p.confidence ?? 1,
    source: p.source ?? 'user_chat',
    sourceTrust: p.sourceTrust ?? 'low',
    verified: p.verified ?? false,
    createdAt: p.createdAt ?? TS,
    traceId: p.traceId ?? 'trace',
  };
}
function risk(p: Partial<RiskEstimate> = {}): RiskEstimate {
  return {
    pRoutine: 0.9,
    pUrgent: 0.05,
    pCritical: 0.05,
    confidence: 0.9,
    oodScore: 0.1,
    evidenceCoverageScore: 0.9,
    reasonCodes: [],
    modelVersion: 'test',
    ...p,
  };
}

const infantFever: EvidenceFact[] = [
  fact({ factType: 'patient_age_months', value: 2 }),
  fact({ factType: 'vital_temperature', value: 101 }),
];

describe('adjudicate only ever returns a finite AllowedAction member', () => {
  it('holds across a grid of risk permutations + red-flag on/off', () => {
    const grid = [0, 0.2, 0.3, 0.4, 0.5, 0.7, 0.8, 1];
    for (const conf of grid) {
      for (const ood of grid) {
        for (const cov of grid) {
          for (const pc of grid) {
            for (const pu of grid) {
              const r = risk({ confidence: conf, oodScore: ood, evidenceCoverageScore: cov, pCritical: pc, pUrgent: pu });
              const out = adjudicate({ evidence: [fact({ factType: 'symptom', value: 'cough' })], riskEstimate: r, bundle: DEFAULT_POLICY });
              expect(ALLOWED_ACTIONS).toContain(out.decision.action);
            }
          }
        }
      }
    }
  });
});

describe('red-flag dominance', () => {
  it('escalates the infant-fever golden path to ED_OR_911 even when the model proposes near-zero risk', () => {
    const out = adjudicate({ evidence: infantFever, riskEstimate: risk({ pRoutine: 0.99, confidence: 0.99 }), bundle: DEFAULT_POLICY });
    expect(out.decision.action).toBe('ED_OR_911_GUIDANCE');
    expect(out.redFlagResult.triggered).toBe(true);
    expect(out.decision.ruleIdsApplied).toContain('infant-fever-floor');
    expect(out.decision.requiresSummarySuppression).toBe(true);
  });

  it('picks the highest-severity action across multiple hits and records all rule ids', () => {
    const evidence = [
      ...infantFever, // infant-fever-floor → ED (sev 4)
      fact({ factType: 'lab_potassium', value: 7 }), // rf-007 → IMMEDIATE_CLINIC_CALLBACK (sev 3)
    ];
    const rf = evaluateRedFlags(evidence, DEFAULT_POLICY.redFlagRules);
    const d = decide(rf, risk(), DEFAULT_POLICY);
    expect(d.action).toBe('ED_OR_911_GUIDANCE');
    expect(ACTION_SEVERITY[d.action]).toBe(4);
    expect(d.ruleIdsApplied).toEqual(expect.arrayContaining(['infant-fever-floor', 'rf-007']));
  });
});

describe('fail-closed (uncertainty escalates, never downgrades)', () => {
  const noFlags = evaluateRedFlags([fact({ factType: 'symptom', value: 'mild' })], DEFAULT_POLICY.redFlagRules);
  it('low confidence → BLOCK', () => {
    expect(decide(noFlags, risk({ confidence: 0.2 }), DEFAULT_POLICY).action).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
  it('high OOD → BLOCK', () => {
    expect(decide(noFlags, risk({ oodScore: 0.8 }), DEFAULT_POLICY).action).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
  it('low evidence coverage → BLOCK', () => {
    expect(decide(noFlags, risk({ evidenceCoverageScore: 0.3 }), DEFAULT_POLICY).action).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
  it('empty evidence → estimateRisk gives conf 0 / ood 1 → BLOCK', () => {
    const r = estimateRisk([], { modelVersion: 'test' });
    expect(r.confidence).toBe(0);
    expect(r.oodScore).toBe(1);
    expect(decide(noFlags, r, DEFAULT_POLICY).action).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
});

describe('inference-check (fail-closed gate)', () => {
  const evidence = infantFever;
  const rf = evaluateRedFlags(evidence, DEFAULT_POLICY.redFlagRules);
  const decision = decide(rf, risk(), DEFAULT_POLICY);
  const ok = { auditPersisted: true, telemetryPersisted: true };

  it('all checks pass → finalAction is the decision action', () => {
    const res = runInferenceCheck(evidence, risk(), rf, DEFAULT_POLICY, decision, ok);
    expect(res.passed).toBe(true);
    expect(res.finalAction).toBe(decision.action);
  });
  it('tampered bundle → policyVerified fails → BLOCK', () => {
    const tampered = { ...DEFAULT_POLICY, metadata: { ...DEFAULT_POLICY.metadata, checksum: 'deadbeef' } };
    const res = runInferenceCheck(evidence, risk(), rf, tampered, decision, ok);
    expect(res.passed).toBe(false);
    expect(res.finalAction).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
  it('prohibited summary → BLOCK', () => {
    const res = runInferenceCheck(evidence, risk(), rf, DEFAULT_POLICY, decision, ok, 'You should increase your dose tonight.');
    expect(res.passed).toBe(false);
  });
  it('confidence out of range → BLOCK; audit not persisted → BLOCK', () => {
    expect(runInferenceCheck(evidence, risk({ confidence: 1.5 }), rf, DEFAULT_POLICY, decision, ok).finalAction).toBe(
      'BLOCK_AND_HUMAN_HANDOFF',
    );
    expect(
      runInferenceCheck(evidence, risk(), rf, DEFAULT_POLICY, decision, { auditPersisted: false, telemetryPersisted: true }).finalAction,
    ).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
});

describe('policy bundle checksum (the tamper-proof claim)', () => {
  it('is stable and 64-hex; verifies the default bundle', () => {
    expect(computeBundleChecksum(DEFAULT_POLICY)).toBe(computeBundleChecksum(DEFAULT_POLICY));
    expect(DEFAULT_POLICY.metadata.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyPolicyBundle(DEFAULT_POLICY).valid).toBe(true);
  });
  it('changes when a rule changes; a tampered checksum is rejected', () => {
    const before = computeBundleChecksum(DEFAULT_POLICY);
    const mutated = { ...DEFAULT_POLICY, redFlagRules: DEFAULT_POLICY.redFlagRules.slice(1) };
    expect(computeBundleChecksum(mutated)).not.toBe(before);
    const tampered = { ...DEFAULT_POLICY, metadata: { ...DEFAULT_POLICY.metadata, checksum: 'deadbeef' } };
    expect(verifyPolicyBundle(tampered).valid).toBe(false);
  });
  it('createPolicyBundle round-trips create → verify with a fresh version', () => {
    const b = createPolicyBundle({
      policyVersion: '1.2.3',
      signedBy: 'test',
      changeNote: 'unit',
      redFlagRules: DEFAULT_POLICY.redFlagRules,
      urgencyThresholds: DEFAULT_URGENCY_THRESHOLDS,
      allowedActions: [...ALLOWED_ACTIONS],
      prohibitedOutputPatterns: DEFAULT_POLICY.prohibitedOutputPatterns,
    });
    expect(b.metadata.policyVersion).toBe('1.2.3');
    expect(verifyPolicyBundle(b).valid).toBe(true);
  });
});

describe('forward-only workflow', () => {
  it('advances forward and rejects backward moves', () => {
    expect(advance('COLLECTING_EVIDENCE', 'ADJUDICATING')).toBe('ADJUDICATING');
    expect(canTransition('GUIDANCE_DELIVERED', 'COLLECTING_EVIDENCE')).toBe(false);
    expect(() => advance('CLOSED', 'ADJUDICATING')).toThrow();
  });
});

describe('risk + red-flag building blocks (VA-5 parity)', () => {
  it('trust-weighted confidence: 0.9@high + 0.5@low ≈ 0.767', () => {
    const c = computeConfidence([
      fact({ factType: 'symptom', value: 'a', confidence: 0.9, sourceTrust: 'high' }),
      fact({ factType: 'symptom', value: 'b', confidence: 0.5, sourceTrust: 'low' }),
    ]);
    expect(c).toBeCloseTo(0.767, 2);
  });
  it('numeric + contains + any_of operators', () => {
    const rf = evaluateRedFlags(
      [fact({ factType: 'symptom', value: 'severe bleeding' })],
      DEFAULT_POLICY.redFlagRules,
    );
    expect(rf.hits.some((h) => h.ruleId === 'rf-005')).toBe(true);
  });
});
