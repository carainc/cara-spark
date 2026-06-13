/**
 * T4 (THIN) — the eval release gate's scoring logic, locked with runnable tests. The gate itself
 * (evals/run.ts) runs the engine over fixtures + adversarial cases and process.exit(1)s below
 * thresholds (sensitivity ≥ 0.95, false-reassurance ≤ 0, adversarial-reach = 0). These tests prove
 * the gate FAILS on a seeded false-negative and on a reassured critical case (fail-closed credibility).
 */
import { describe, it, expect } from 'vitest';
import { score, isEscalation, isReassurance, type CaseOutcome } from '@/evals/scorers';

describe('eval gate scorers (T4)', () => {
  it('classifies escalation vs reassurance', () => {
    expect(isEscalation('ED_OR_911_GUIDANCE')).toBe(true);
    expect(isEscalation('SAME_DAY_REVIEW')).toBe(true);
    expect(isEscalation('ROUTINE_REVIEW')).toBe(false);
    expect(isReassurance('SELF_CARE_INFO_ONLY')).toBe(true);
    expect(isReassurance('ROUTINE_REVIEW')).toBe(false);
  });

  it('full sensitivity + zero false-reassurance on correct outcomes', () => {
    const outcomes: CaseOutcome[] = [
      { id: 'c1', critical: true, action: 'ED_OR_911_GUIDANCE' },
      { id: 'c2', critical: true, action: 'SAME_DAY_REVIEW' },
      { id: 'r1', critical: false, action: 'SELF_CARE_INFO_ONLY' },
    ];
    const s = score(outcomes);
    expect(s.sensitivity).toBe(1);
    expect(s.falseReassurance).toBe(0);
  });

  it('a SEEDED FALSE-NEGATIVE drops sensitivity below threshold → gate fails', () => {
    const s = score([
      { id: 'c1', critical: true, action: 'ED_OR_911_GUIDANCE' },
      { id: 'c2', critical: true, action: 'ROUTINE_REVIEW' }, // critical missed
    ]);
    expect(s.sensitivity).toBeLessThan(0.95);
  });

  it('a reassured critical case raises false-reassurance → gate fails', () => {
    const s = score([{ id: 'c1', critical: true, action: 'SELF_CARE_INFO_ONLY' }]);
    expect(s.falseReassurance).toBeGreaterThan(0);
  });
});
