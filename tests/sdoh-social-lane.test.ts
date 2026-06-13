/**
 * tk-0027 — the SDOH (social determinants of health) social-needs lane in the deterministic engine.
 *
 * The live bug: a user typed "I am looking for food". The model proposed
 * chief_complaint = "seeking food / hunger", low risk, NO red flag — but evidenceCoverageScore ≈ 0.10
 * (< the 0.4 review threshold), so the engine fail-CLOSED to BLOCK_AND_HUMAN_HANDOFF. For a PURE
 * resource ask that is wrong: it should surface community resources (the food-bank referral), not
 * "this needs a person."
 *
 * These tests lock the fix AND its safety envelope, end-to-end through `adjudicate` (the live path)
 * and at the unit level (`decide`, `isPureSocialNeed`). The engine is a pure function — no network,
 * no DB, no AI here; we feed typed evidence + a model-proposed risk and assert the decision.
 *
 *   (a) social-need evidence (chief_complaint "seeking food", no symptoms, low risk, thin coverage)
 *       → NOT blocked; disposition is SELF_CARE_INFO_ONLY; the referral path is eligible.
 *   (b) thin CLINICAL evidence (a real symptom, coverage 0.1) → STILL BLOCK_AND_HUMAN_HANDOFF.
 *   (c) mixed food + a clinical red flag → STILL escalates clinically (ED/911).
 *
 * The safety thesis under test: the lane only ever DOWN-classifies a request with ZERO clinical
 * signal. Any clinical fact, any non-social symptom value, any red flag, or non-low risk keeps the
 * clinical engine in control.
 */
import { describe, it, expect } from 'vitest';
import { adjudicate } from '@/engine';
import { decide, isPureSocialNeed, SOCIAL_NEED_KEYWORDS } from '@/engine/policy';
import { DEFAULT_POLICY, DEFAULT_URGENCY_THRESHOLDS } from '@/engine/policy-bundle';
import { isReferralEligible } from '@/lib/agent/referral';
import type { EvidenceFact, RedFlagResult, RiskEstimate } from '@/engine/types';

const FIXED_TS = '2026-06-13T12:00:00.000Z';

/** Build a full EvidenceFact from a partial — user_chat / low trust, like the live web/voice path. */
function fact(over: Partial<EvidenceFact>): EvidenceFact {
  return {
    id: 'f-0',
    factType: 'chief_complaint',
    value: 'seeking food / hunger',
    confidence: 0.8,
    source: 'user_chat',
    sourceTrust: 'low',
    verified: false,
    createdAt: FIXED_TS,
    traceId: 't-sdoh',
    ...over,
  };
}

const NO_RED_FLAGS: RedFlagResult = { triggered: false, hits: [] };

/** A risk shape that matches the live trace: low acuity, but THIN coverage (0.10 < 0.4 review). */
function risk(over: Partial<RiskEstimate> = {}): RiskEstimate {
  return {
    pRoutine: 0.8,
    pUrgent: 0.1,
    pCritical: 0.02,
    confidence: 0.85, // >= abstention (0.3); not abstaining
    oodScore: 0.1, // <= ood (0.7); in-distribution
    evidenceCoverageScore: 0.1, // < review (0.4) — the old fail-closed BLOCK trigger
    reasonCodes: ['social_need'],
    modelVersion: 'test',
    ...over,
  };
}

describe('tk-0027 — isPureSocialNeed (the fail-safe gate)', () => {
  it('a chief_complaint on the social allowlist with no clinical signal IS a pure social need', () => {
    expect(isPureSocialNeed([fact({ value: 'seeking food / hunger' })])).toBe(true);
    expect(isPureSocialNeed([fact({ value: 'I am looking for food' })])).toBe(true);
    expect(isPureSocialNeed([fact({ factType: 'condition', value: 'housing instability' })])).toBe(true);
    expect(isPureSocialNeed([fact({ factType: 'symptom', value: 'need transportation to clinic' })])).toBe(true);
  });

  it('every allowlist keyword is detectable as a social need (documents the list)', () => {
    for (const kw of SOCIAL_NEED_KEYWORDS) {
      expect(isPureSocialNeed([fact({ value: `need ${kw} please` })])).toBe(true);
    }
  });

  it('empty evidence is NOT a social need (fail safe — nothing to down-classify)', () => {
    expect(isPureSocialNeed([])).toBe(false);
  });

  it('a complaint NOT on the allowlist is NOT a social need (it is a clinical complaint)', () => {
    expect(isPureSocialNeed([fact({ value: 'severe headache' })])).toBe(false);
    expect(isPureSocialNeed([fact({ factType: 'symptom', value: 'chest_pain' })])).toBe(false);
  });

  it('SAFETY — ANY clinical-signal fact disqualifies, even alongside a social keyword', () => {
    // food + a vital → clinical signal present → NOT a pure social need.
    expect(
      isPureSocialNeed([
        fact({ id: 'a', value: 'looking for food' }),
        fact({ id: 'b', factType: 'vital_temperature', value: 101 }),
      ]),
    ).toBe(false);
    // food + a clinical symptom value → that symptom is non-social signal → disqualify.
    expect(
      isPureSocialNeed([
        fact({ id: 'a', value: 'looking for food' }),
        fact({ id: 'b', factType: 'symptom', value: 'chest_pain' }),
      ]),
    ).toBe(false);
    // food + a mental-health fact → disqualify (mental-health is clinical signal).
    expect(
      isPureSocialNeed([
        fact({ id: 'a', value: 'need housing' }),
        fact({ id: 'b', factType: 'mental_health', value: 'suicidal_ideation' }),
      ]),
    ).toBe(false);
    // food + a lab/medication/age → disqualify.
    expect(isPureSocialNeed([fact({ value: 'food' }), fact({ id: 'b', factType: 'lab_value', value: 5.1 })])).toBe(
      false,
    );
    expect(
      isPureSocialNeed([fact({ value: 'food' }), fact({ id: 'b', factType: 'patient_age_months', value: 2 })]),
    ).toBe(false);
  });
});

describe('tk-0027 (a) — a pure social/resource need is NOT blocked; it routes to SELF_CARE_INFO_ONLY', () => {
  const evidence = [fact({ value: 'seeking food / hunger' })];

  it('decide(): no red flag + thin coverage + pure social need + low risk → SELF_CARE_INFO_ONLY (not BLOCK)', () => {
    const d = decide(NO_RED_FLAGS, risk(), DEFAULT_POLICY, evidence);
    expect(d.action).toBe('SELF_CARE_INFO_ONLY');
    expect(d.action).not.toBe('BLOCK_AND_HUMAN_HANDOFF');
    expect(d.requiresHumanReview).toBe(false);
    expect(d.decisionReason).toContain('social/resource need');
    expect(d.decisionReason).toContain('community resources');
  });

  it('adjudicate(): the LIVE path — "I am looking for food" surfaces self-care, not a human handoff', () => {
    const trace = adjudicate({ evidence, riskEstimate: risk(), bundle: DEFAULT_POLICY });
    expect(trace.decision.action).toBe('SELF_CARE_INFO_ONLY');
    expect(trace.workflowState).toBe('GUIDANCE_DELIVERED'); // NOT HUMAN_HANDOFF
    expect(trace.redFlagResult.triggered).toBe(false);
    // The disposition is referral-eligible → the community-resource (food-bank) RAG will surface.
    expect(isReferralEligible(trace.decision.action)).toBe(true);
  });
});

describe('tk-0027 (b) — thin CLINICAL evidence STILL fail-closes (the existing BLOCK is intact)', () => {
  it('a real symptom with low coverage and no social keyword → BLOCK_AND_HUMAN_HANDOFF (unchanged)', () => {
    const clinical = [fact({ factType: 'symptom', value: 'abdominal_pain' })];
    const d = decide(NO_RED_FLAGS, risk(), DEFAULT_POLICY, clinical);
    expect(d.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
    expect(d.decisionReason).toContain('Evidence coverage');
    expect(d.requiresHumanReview).toBe(true);
  });

  it('adjudicate(): thin clinical evidence routes to a human (no down-classification)', () => {
    const clinical = [fact({ factType: 'symptom', value: 'dizziness' })];
    const trace = adjudicate({ evidence: clinical, riskEstimate: risk(), bundle: DEFAULT_POLICY });
    expect(trace.decision.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
    expect(trace.workflowState).toBe('HUMAN_HANDOFF');
  });

  it('a social complaint that LOOKS social but rides with a clinical symptom → BLOCK, not self-care', () => {
    // "food" present, but a real clinical symptom is also present → not pure social → coverage BLOCK.
    const mixed = [
      fact({ id: 'a', value: 'looking for food' }),
      fact({ id: 'b', factType: 'symptom', value: 'severe_abdominal_pain' }),
    ];
    const d = decide(NO_RED_FLAGS, risk(), DEFAULT_POLICY, mixed);
    expect(d.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
});

describe('tk-0027 (c) — food + a clinical red flag STILL escalates clinically (red flags dominate)', () => {
  it('adjudicate(): a resource ask alongside an infant fever → ED_OR_911_GUIDANCE, never self-care', () => {
    // DEFAULT_POLICY has an infant-fever red flag. Food keyword present, but a vital + age fire it.
    const evidence = [
      fact({ id: 'a', factType: 'chief_complaint', value: 'looking for food and my baby has a fever' }),
      fact({ id: 'b', factType: 'patient_age_months', value: 2, source: 'form_submission', sourceTrust: 'low' }),
      fact({ id: 'c', factType: 'vital_temperature', value: 101 }),
    ];
    const trace = adjudicate({ evidence, riskEstimate: risk(), bundle: DEFAULT_POLICY });
    // The red flag dominates — the social lane never even runs (it is below red-flag in decide()).
    expect(trace.redFlagResult.triggered).toBe(true);
    expect(trace.decision.action).toBe('ED_OR_911_GUIDANCE');
    expect(isReferralEligible(trace.decision.action)).toBe(false); // no referral on an emergency
  });

  it('decide(): if a red flag fired, the social lane is bypassed even with a food complaint', () => {
    const redFlagFired: RedFlagResult = {
      triggered: true,
      hits: [
        {
          ruleId: 'rf-test',
          ruleName: 'Test escalation',
          matchedFactIds: ['a'],
          action: 'ED_OR_911_GUIDANCE',
          timestamp: FIXED_TS,
        },
      ],
    };
    const evidence = [fact({ value: 'looking for food' })];
    const d = decide(redFlagFired, risk(), DEFAULT_POLICY, evidence);
    expect(d.action).toBe('ED_OR_911_GUIDANCE');
  });
});

describe('tk-0027 — risk-gating: a social ask with NON-low clinical risk does NOT down-classify', () => {
  it('pUrgent at/above the urgent threshold → the social lane does not fire (clinical risk governs)', () => {
    // Even with a social keyword + thin coverage, urgent risk means this is not a no-signal request.
    // With coverage 0.1 < review, the engine still BLOCKs (coverage gate) rather than self-care.
    const evidence = [fact({ value: 'looking for food' })];
    const urgent = risk({ pUrgent: DEFAULT_URGENCY_THRESHOLDS.urgentThreshold + 0.1 });
    const d = decide(NO_RED_FLAGS, urgent, DEFAULT_POLICY, evidence);
    expect(d.action).not.toBe('SELF_CARE_INFO_ONLY');
  });

  it('pCritical at/above the escalate threshold → the social lane does not fire', () => {
    const evidence = [fact({ value: 'looking for food' })];
    const critical = risk({
      pCritical: DEFAULT_URGENCY_THRESHOLDS.escalateThreshold + 0.05,
      evidenceCoverageScore: 0.9, // ample coverage, so the coverage gate is not what stops it
    });
    const d = decide(NO_RED_FLAGS, critical, DEFAULT_POLICY, evidence);
    expect(d.action).toBe('ED_OR_911_GUIDANCE'); // the critical lane governs, not the social lane
  });
});

describe('tk-0027 — abstention/OOD still fail closed for a social ask (those gates precede the lane)', () => {
  it('low confidence → BLOCK even for a food complaint (uncertainty fails closed first)', () => {
    const evidence = [fact({ value: 'looking for food' })];
    const lowConf = risk({ confidence: DEFAULT_URGENCY_THRESHOLDS.abstentionThreshold - 0.05 });
    expect(decide(NO_RED_FLAGS, lowConf, DEFAULT_POLICY, evidence).action).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });

  it('high OOD → BLOCK even for a food complaint', () => {
    const evidence = [fact({ value: 'looking for food' })];
    const highOod = risk({ oodScore: DEFAULT_URGENCY_THRESHOLDS.oodThreshold + 0.05 });
    expect(decide(NO_RED_FLAGS, highOod, DEFAULT_POLICY, evidence).action).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
});

describe('tk-0027 — backward compatibility: decide() without evidence is unchanged (fail safe)', () => {
  it('omitting evidence → the social lane never fires; thin coverage still BLOCKs as before', () => {
    // This is how lib/audit what-if probes call decide(): no evidence arg.
    const d = decide(NO_RED_FLAGS, risk(), DEFAULT_POLICY);
    expect(d.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
  });
});
