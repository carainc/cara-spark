/**
 * TDD anchor for T1. RED until the VA-5 port lands (engine functions throw NotImplemented).
 * This is the golden path of demo beat 1: a 2-month-old with a 101°F fever MUST escalate to
 * ED_OR_911_GUIDANCE, and the model must not be able to soften it.
 *
 * T1 turns these green; T1 also adds the full mandatory suite (red-flag dominance, fail-closed,
 * inference-check, forward-only workflow, checksum stable + tamper-rejected).
 */
import { describe, it, expect } from 'vitest';
import { adjudicate, ALLOWED_ACTIONS, canTransition } from '@/engine';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';
import type { AdjudicateInput, EvidenceFact, RiskEstimate } from '@/engine/types';

const traceId = 'test-trace-1';

const infantFeverEvidence: EvidenceFact[] = [
  {
    id: 'f-age',
    factType: 'patient_age_months',
    value: 2,
    confidence: 1,
    source: 'form_submission',
    sourceTrust: 'low',
    verified: false,
    createdAt: '2026-06-13T00:00:00.000Z',
    traceId,
  },
  {
    id: 'f-temp',
    factType: 'vital_temperature',
    value: 101,
    confidence: 1,
    source: 'user_chat',
    sourceTrust: 'low',
    verified: false,
    createdAt: '2026-06-13T00:00:00.000Z',
    traceId,
  },
];

const lowRisk: RiskEstimate = {
  pRoutine: 0.9,
  pUrgent: 0.05,
  pCritical: 0.05,
  confidence: 0.9,
  oodScore: 0.1,
  evidenceCoverageScore: 0.9,
  reasonCodes: [],
  modelVersion: 'test',
};

describe('engine.adjudicate — infant fever floor (demo beat 1 golden path)', () => {
  it('escalates a 2-month-old with 101°F fever to ED_OR_911_GUIDANCE even when the model proposes low risk', () => {
    const input: AdjudicateInput = {
      evidence: infantFeverEvidence,
      riskEstimate: lowRisk,
      bundle: DEFAULT_POLICY,
    };
    const trace = adjudicate(input);

    expect(trace.decision.action).toBe('ED_OR_911_GUIDANCE');
    expect(trace.redFlagResult.triggered).toBe(true);
    expect(trace.decision.ruleIdsApplied).toContain('infant-fever-floor');
    // the action must be a member of the finite allowed set
    expect(ALLOWED_ACTIONS).toContain(trace.decision.action);
  });
});

describe('workflow is forward-only', () => {
  it('allows forward + same-state transitions and forbids backward', () => {
    expect(canTransition('COLLECTING_EVIDENCE', 'ADJUDICATING')).toBe(true);
    expect(canTransition('ADJUDICATING', 'ADJUDICATING')).toBe(true);
    expect(canTransition('GUIDANCE_DELIVERED', 'COLLECTING_EVIDENCE')).toBe(false);
  });
});
