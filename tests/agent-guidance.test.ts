/**
 * Lane D / T7 — the canned guidance + trace-panel view-model. Asserts: every AllowedAction has
 * bilingual canned text; escalation actions are flagged; NO guidance string contains prescribe /
 * diagnose / dose language (not-medical-advice discipline); the trace panel reflects the engine's
 * decision and the model can't change the rendered action. Pure — uses the REAL engine + fixtures.
 */
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { adjudicate } from '@/engine';
import { ALLOWED_ACTIONS, type EvidenceFact, type RiskEstimate } from '@/engine/types';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';
import { CASES, buildEvidence, buildRisk } from '@/fixtures/cases';
import { guidanceFor, buildTracePanel, decideTurnMode, ESCALATION_ACTIONS } from '@/lib/agent/guidance';
import { LANGS } from '@/lib/i18n';

describe('canned guidance covers every AllowedAction, bilingually', () => {
  for (const action of ALLOWED_ACTIONS) {
    for (const lang of LANGS) {
      it(`${action} / ${lang} has non-empty canned text`, () => {
        const g = guidanceFor(action, lang);
        expect(typeof g).toBe('string');
        expect(g.length).toBeGreaterThan(10);
      });
    }
  }

  it('NO guidance string prescribes, diagnoses, or doses (not-medical-advice discipline)', () => {
    const forbidden = ['prescrib', 'diagnos', ' dose', 'mg ', 'milligram', 'take this medication'];
    for (const action of ALLOWED_ACTIONS) {
      for (const lang of LANGS) {
        const g = guidanceFor(action, lang).toLowerCase();
        for (const f of forbidden) expect(g, `${action}/${lang} contains "${f}"`).not.toContain(f);
      }
    }
  });

  it('escalation actions point to 911 / emergency department (EN) and 911 / sala de emergencias (ES)', () => {
    for (const action of ESCALATION_ACTIONS) {
      expect(guidanceFor(action, 'en')).toMatch(/911|emergency department|care team/i);
      expect(guidanceFor(action, 'es')).toMatch(/911|sala de emergencias|equipo de atención/i);
    }
  });
});

describe('buildTracePanel — reflects the engine decision; checksum/signature provable', () => {
  const infant = CASES.find((c) => c.id === 'infant-fever-en')!;
  const trace = adjudicate({ evidence: buildEvidence(infant), riskEstimate: buildRisk(infant), bundle: DEFAULT_POLICY });

  it('shows the engine action + the fired rule + the canned guidance for that action', () => {
    const panel = buildTracePanel(trace, 'en');
    expect(panel.action).toBe('ED_OR_911_GUIDANCE');
    expect(panel.redFlagFired).toBe(true);
    expect(panel.isEscalation).toBe(true);
    expect(panel.rules.map((r) => r.ruleId)).toContain('infant-fever-floor');
    expect(panel.guidance).toBe(guidanceFor('ED_OR_911_GUIDANCE', 'en'));
  });

  it('surfaces the policy bundle version + a valid checksum (provable trace)', () => {
    const panel = buildTracePanel(trace, 'en');
    expect(panel.bundleVersion).toBe(DEFAULT_POLICY.metadata.policyVersion);
    expect(panel.checksum).toBe(DEFAULT_POLICY.metadata.checksum);
    expect(panel.checksumValid).toBe(true);
  });

  it('carries the model-proposed risk (π) alongside the engine action — the split is visible', () => {
    const panel = buildTracePanel(trace, 'en');
    // The model proposed low risk; the panel preserves that, while the action is the escalation.
    expect(panel.risk.pCritical).toBeLessThan(0.5);
    expect(panel.action).toBe('ED_OR_911_GUIDANCE');
  });

  it('evidence in the panel is structured factType/value pairs only (no PHI shape)', () => {
    const panel = buildTracePanel(trace, 'en');
    const types = panel.evidence.map((e) => e.factType);
    expect(types).toContain('patient_age_months');
    expect(types).toContain('vital_temperature');
    // none of the evidence is a name/dob/phone factType
    for (const e of panel.evidence) {
      expect(['full_name', 'name', 'dob', 'date_of_birth', 'phone', 'email']).not.toContain(e.factType);
    }
  });
});

// =============================================================================
// converse-vs-present (tk-0029) — the multi-turn interpretation of the engine's decision.
//
// THE RULE, proven against the REAL engine: the chat CONTINUES ('converse') ONLY for the benign
// "not enough info yet" block — a BLOCK_AND_HUMAN_HANDOFF caused by low confidence (abstention) or
// low evidence coverage, with NO red flag. EVERYTHING else PRESENTS a final safe next step — and,
// non-negotiably, every SAFETY outcome (red flag, emergency escalation, fail-closed block) presents
// immediately. When in doubt, present (fail safe).
// =============================================================================

/** Build a model-blind EvidenceFact set (chat source, low trust) for a synthetic risk-only probe. */
function fact(factType: string, value: unknown): EvidenceFact {
  return {
    id: `tk29-${factType}`,
    factType,
    value,
    confidence: 0.8,
    source: 'user_chat',
    sourceTrust: 'low',
    verified: false,
    createdAt: '2026-06-13T12:00:00.000Z',
    traceId: 'tk29-trace',
  };
}

/** A complete RiskEstimate with sensible defaults; override only the field a branch turns on. */
function risk(overrides: Partial<RiskEstimate> = {}): RiskEstimate {
  return {
    pRoutine: 0.9,
    pUrgent: 0.05,
    pCritical: 0.05,
    confidence: 0.9,
    oodScore: 0.1,
    evidenceCoverageScore: 0.9,
    reasonCodes: [],
    modelVersion: 'tk29',
    ...overrides,
  };
}

describe('converse-vs-present — keep talking ONLY on a benign low-info block', () => {
  // DEFAULT_POLICY thresholds: abstention 0.3, ood 0.7, review 0.4, escalate 0.7, urgent 0.5.

  it('LOW EVIDENCE COVERAGE, no red flag → converse (continue the conversation, no scary card)', () => {
    // coverage 0.2 < reviewThreshold 0.4, but confidence high + risk low → the evidence-insufficiency
    // BLOCK. This is the "ask the next question" case.
    const trace = adjudicate({
      evidence: [fact('symptom', 'headache')],
      riskEstimate: risk({ evidenceCoverageScore: 0.2 }),
      bundle: DEFAULT_POLICY,
    });
    expect(trace.decision.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
    expect(trace.redFlagResult.triggered).toBe(false);
    expect(trace.decision.decisionReason).toMatch(/^Evidence coverage /);
    expect(decideTurnMode(trace)).toBe('converse');
    expect(buildTracePanel(trace, 'en').turnMode).toBe('converse');
  });

  it('LOW CONFIDENCE (abstention), no red flag → converse', () => {
    // confidence 0.2 < abstentionThreshold 0.3 → the abstention BLOCK. Still "gather more", not a person.
    const trace = adjudicate({
      evidence: [fact('symptom', 'tired')],
      riskEstimate: risk({ confidence: 0.2 }),
      bundle: DEFAULT_POLICY,
    });
    expect(trace.decision.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
    expect(trace.redFlagResult.triggered).toBe(false);
    expect(trace.decision.decisionReason).toMatch(/^Confidence /);
    expect(decideTurnMode(trace)).toBe('converse');
  });

  // --- SAFETY: these MUST always present, never defer to "let's keep chatting". ---

  it('RED FLAG fired (infant fever) → ALWAYS present (emergency surfaces immediately)', () => {
    const infant = CASES.find((c) => c.id === 'infant-fever-en')!;
    const trace = adjudicate({
      evidence: buildEvidence(infant),
      riskEstimate: buildRisk(infant),
      bundle: DEFAULT_POLICY,
    });
    expect(trace.redFlagResult.triggered).toBe(true);
    expect(trace.decision.action).toBe('ED_OR_911_GUIDANCE');
    expect(decideTurnMode(trace)).toBe('present');
    expect(buildTracePanel(trace, 'en').turnMode).toBe('present');
  });

  it('EMERGENCY escalation by risk (pCritical high) → present', () => {
    const trace = adjudicate({
      evidence: [fact('symptom', 'chest_tightness')],
      riskEstimate: risk({ pCritical: 0.85 }), // >= escalateThreshold 0.7
      bundle: DEFAULT_POLICY,
    });
    expect(trace.decision.action).toBe('ED_OR_911_GUIDANCE');
    expect(decideTurnMode(trace)).toBe('present');
  });

  it('IMMEDIATE_CLINIC_CALLBACK (high pUrgent) → present', () => {
    const trace = adjudicate({
      evidence: [fact('symptom', 'severe_pain')],
      riskEstimate: risk({ pUrgent: 0.95, pCritical: 0.1 }), // urgent + >= immediateCallbackThreshold
      bundle: DEFAULT_POLICY,
    });
    expect(trace.decision.action).toBe('IMMEDIATE_CLINIC_CALLBACK');
    expect(decideTurnMode(trace)).toBe('present');
  });

  it('OOD (out-of-distribution) BLOCK → present (this is "unusual, get a human", NOT converse)', () => {
    // oodScore 0.9 > oodThreshold 0.7 → an abstention BLOCK, but for OOD — a genuine fail-safe signal.
    const trace = adjudicate({
      evidence: [fact('symptom', 'unusual')],
      riskEstimate: risk({ oodScore: 0.9 }),
      bundle: DEFAULT_POLICY,
    });
    expect(trace.decision.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
    expect(trace.redFlagResult.triggered).toBe(false);
    expect(trace.decision.decisionReason).toMatch(/^OOD /);
    // Even though it is a no-red-flag block, OOD is NOT the low-info path → present (fail safe).
    expect(decideTurnMode(trace)).toBe('present');
  });

  it('CONFIDENT routine self-care → present the safe next step', () => {
    const trace = adjudicate({
      evidence: [fact('symptom', 'runny_nose')],
      riskEstimate: risk(), // low risk, high confidence + coverage → SELF_CARE_INFO_ONLY
      bundle: DEFAULT_POLICY,
    });
    expect(trace.decision.action).toBe('SELF_CARE_INFO_ONLY');
    expect(decideTurnMode(trace)).toBe('present');
  });

  it('SDOH social-needs (pure food request) → present the resource info', () => {
    // Pure social need, zero clinical signal, low risk → SELF_CARE_INFO_ONLY via the SDOH lane.
    const trace = adjudicate({
      evidence: [fact('chief_complaint', 'looking for food')],
      riskEstimate: risk({ evidenceCoverageScore: 0.1 }), // would be a low-info block but for the SDOH lane
      bundle: DEFAULT_POLICY,
    });
    expect(trace.decision.action).toBe('SELF_CARE_INFO_ONLY');
    const panel = buildTracePanel(trace, 'en');
    expect(panel.socialNeed).toBe(true);
    expect(decideTurnMode(trace)).toBe('present');
    expect(panel.turnMode).toBe('present');
  });

  describe('fail-closed signature-invalid BLOCK → present (never hidden behind a conversation)', () => {
    const PRIOR = process.env.VOICE_CONFIG_HMAC_SECRET;
    beforeEach(() => {
      process.env.VOICE_CONFIG_HMAC_SECRET = 'tk29-secret';
    });
    afterEach(() => {
      if (PRIOR === undefined) delete process.env.VOICE_CONFIG_HMAC_SECRET;
      else process.env.VOICE_CONFIG_HMAC_SECRET = PRIOR;
    });

    it('a bundle that CLAIMS a signature that does not verify fails closed and PRESENTS', () => {
      // Forge a signature on the default bundle: claims one, but it will not verify under the secret.
      const forged = {
        ...DEFAULT_POLICY,
        metadata: { ...DEFAULT_POLICY.metadata, signature: 'deadbeef'.repeat(8), signatureAlgorithm: 'hmac-sha256' as const },
      };
      const trace = adjudicate({
        evidence: [fact('symptom', 'cough')],
        riskEstimate: risk(),
        bundle: forged,
      });
      expect(trace.decision.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
      expect(trace.bundle.signatureValid).toBe(false);
      expect(trace.decision.decisionReason).toMatch(/signature invalid/i);
      // A fail-closed safety block is NOT the benign low-info path → present immediately.
      expect(decideTurnMode(trace)).toBe('present');
    });
  });
});
