import { describe, it, expect } from 'vitest';
import {
  computeEvidenceCoverage,
  computeConfidence,
  computeOodScore,
  computeProbabilities,
  estimateRisk,
} from '@/engine/risk';
import type { EvidenceFact } from '@/engine/types';
import { riskEstimateSchema } from '@/engine/types';

let seq = 0;
function fact(over: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    id: `f_${++seq}`,
    factType: 'symptom',
    value: 'cough',
    confidence: 0.8,
    source: 'user_chat',
    sourceTrust: 'medium',
    verified: false,
    createdAt: '2026-06-13T00:00:00.000Z',
    traceId: 'trace_1',
    ...over,
  };
}

describe('risk.computeEvidenceCoverage', () => {
  it('empty evidence → 0', () => {
    expect(computeEvidenceCoverage([])).toBe(0);
  });
  it('full volume + diversity + verification → 1', () => {
    const full = [
      fact({ factType: 'symptom', verified: true }),
      fact({ factType: 'vital_sign', verified: true }),
      fact({ factType: 'duration', verified: true }),
    ];
    expect(computeEvidenceCoverage(full, 3, 2)).toBeCloseTo(1, 5);
  });
  it('a single unverified fact is well below full coverage', () => {
    expect(computeEvidenceCoverage([fact({ verified: false })], 3, 2)).toBeLessThan(1);
  });
});

describe('risk.computeConfidence', () => {
  it('empty → 0', () => {
    expect(computeConfidence([])).toBe(0);
  });
  it('weights by source trust (high outweighs low)', () => {
    const c = computeConfidence([
      fact({ confidence: 1, sourceTrust: 'high' }),
      fact({ confidence: 0, sourceTrust: 'low' }),
    ]);
    expect(c).toBeCloseTo(1 / 1.5, 5); // (1*1 + 0*0.5) / (1 + 0.5)
  });
});

describe('risk.computeOodScore', () => {
  it('empty → 1 (fully out-of-distribution)', () => {
    expect(computeOodScore([])).toBe(1);
  });
  it('known fact types → 0; unknown → ratio', () => {
    expect(computeOodScore([fact({ factType: 'symptom' })])).toBe(0);
    expect(
      computeOodScore([fact({ factType: 'symptom' }), fact({ factType: 'totally_unknown_type' })]),
    ).toBe(0.5);
  });
});

describe('risk.computeProbabilities', () => {
  it('no signals → routine baseline + reason code', () => {
    const p = computeProbabilities([fact({ value: 'mild cough' })]);
    expect(p).toMatchObject({ pRoutine: 0.85, pUrgent: 0.1, pCritical: 0.05 });
    expect(p.reasonCodes).toContain('routine_presentation');
  });
  it('a critical signal drives pCritical up + emits a reason code', () => {
    const p = computeProbabilities([fact({ value: 'patient had a seizure', sourceTrust: 'high' })]);
    expect(p.pCritical).toBeGreaterThan(0);
    expect(p.reasonCodes.some((r) => r.startsWith('critical_signal:'))).toBe(true);
  });
  it('an urgent signal drives pUrgent up + emits a reason code', () => {
    const p = computeProbabilities([fact({ value: 'chest pain reported', sourceTrust: 'high' })]);
    expect(p.pUrgent).toBeGreaterThan(0);
    expect(p.reasonCodes.some((r) => r.startsWith('urgent_signal:'))).toBe(true);
  });
  it('high-trust severity=critical contributes to pCritical', () => {
    const p = computeProbabilities([fact({ factType: 'severity', value: 'critical', sourceTrust: 'high' })]);
    expect(p.pCritical).toBeGreaterThan(0);
  });
  it('probabilities stay within [0,1] under multiple critical signals', () => {
    const p = computeProbabilities([
      fact({ value: 'cardiac arrest', sourceTrust: 'high' }),
      fact({ value: 'severe bleeding', sourceTrust: 'high' }),
    ]);
    expect(p.pCritical).toBeGreaterThanOrEqual(0);
    expect(p.pCritical).toBeLessThanOrEqual(1);
    expect(p.pUrgent).toBeLessThanOrEqual(1);
    expect(p.pRoutine).toBeGreaterThanOrEqual(0);
  });
});

describe('risk.estimateRisk (schema-valid assembly)', () => {
  it('empty evidence → no_evidence shape, schema-valid', () => {
    const r = estimateRisk([], { modelVersion: 'm1' });
    expect(r.reasonCodes).toContain('no_evidence');
    expect(r.oodScore).toBe(1);
    expect(riskEstimateSchema.safeParse(r).success).toBe(true);
  });
  it('non-empty evidence → assembled, schema-valid RiskEstimate carrying modelVersion', () => {
    const r = estimateRisk([fact({ value: 'chest pain', sourceTrust: 'high' })], { modelVersion: 'm1' });
    expect(r.modelVersion).toBe('m1');
    expect(riskEstimateSchema.safeParse(r).success).toBe(true);
  });
});
