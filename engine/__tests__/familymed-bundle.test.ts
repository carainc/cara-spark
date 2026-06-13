/**
 * familymed-v1 bundle suite (tk-0025). Dr. Hobbs's family-medicine gates as a SIGNED policy bundle.
 * Locks: representative Tier-1/Tier-2 gates escalate to ED_OR_911_GUIDANCE; the bundle signs +
 * checksum-verifies + resolves through the engine registry; and — critically — the bundle only ever
 * ADDS escalation (a well case with no gate firing is NOT escalated by these rules), so it can never
 * introduce false reassurance. The engine itself (red-flag dominance, fail-closed) is covered by the
 * core engine suite; here we exercise the bundle's CONTENT through the real `adjudicate` path.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  adjudicate,
  ALLOWED_ACTIONS,
  evaluateRedFlags,
  verifyPolicyBundle,
  verifyBundleSignature,
  getRegisteredBundle,
  listRegisteredBundles,
} from '@/engine';
import {
  buildFamilymedBundle,
  activeFamilymedBundle,
  FAMILYMED_BUNDLE_VERSION,
  FAMILYMED_RED_FLAG_RULES,
} from '@/engine/familymed-bundle';
import type { EvidenceFact, RiskEstimate } from '@/engine/types';

const TS = '2026-06-13T12:00:00.000Z';
const BUNDLE = buildFamilymedBundle();

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
    traceId: p.traceId ?? 'fm-trace',
  };
}

/** The model proposes LOW risk for every case — the gates must dominate regardless. */
const lowRisk: RiskEstimate = {
  pRoutine: 0.95,
  pUrgent: 0.03,
  pCritical: 0.02,
  confidence: 0.95,
  oodScore: 0.05,
  evidenceCoverageScore: 0.95,
  reasonCodes: [],
  modelVersion: 'test',
};

function act(evidence: EvidenceFact[]) {
  return adjudicate({ evidence, riskEstimate: lowRisk, bundle: BUNDLE }).decision.action;
}

describe('familymed-v1 — Tier-1 core gates escalate to ED even when the model proposes low risk', () => {
  it('chest pressure + radiation + diaphoresis (ACS) → ED_OR_911_GUIDANCE', () => {
    expect(
      act([
        fact({ factType: 'symptom', value: 'chest pressure' }),
        fact({ factType: 'symptom', value: 'radiation to left arm' }),
        fact({ factType: 'symptom', value: 'cold sweat / diaphoresis' }),
      ]),
    ).toBe('ED_OR_911_GUIDANCE');
  });

  it('thunderclap headache → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'chief_complaint', value: 'thunderclap headache, worst of my life' })])).toBe(
      'ED_OR_911_GUIDANCE',
    );
  });

  it('BE-FAST positive (coded one-sided weakness + slurred speech) → ED_OR_911_GUIDANCE', () => {
    expect(
      act([
        fact({ factType: 'symptom', value: 'unilateral_weakness' }),
        fact({ factType: 'symptom', value: 'slurred_speech' }),
      ]),
    ).toBe('ED_OR_911_GUIDANCE');
  });

  it('resolved TIA still escalates (symptoms gone but the gate fires) → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'symptom', value: 'tia' })])).toBe('ED_OR_911_GUIDANCE');
  });

  it('severe dyspnea (blue lips, cannot speak a full sentence) → ED_OR_911_GUIDANCE', () => {
    expect(
      act([
        fact({ factType: 'symptom', value: 'blue_lips' }),
        fact({ factType: 'symptom', value: 'cannot_speak_full_sentence' }),
      ]),
    ).toBe('ED_OR_911_GUIDANCE');
  });

  it('anaphylaxis (throat tightness after a sting) → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'symptom', value: 'throat_tightness' })])).toBe('ED_OR_911_GUIDANCE');
  });

  it('GI bleed (coffee-ground vomit / black tarry stool) → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'symptom', value: 'black tarry stool' })])).toBe('ED_OR_911_GUIDANCE');
  });

  it('mental-health crisis (suicidal intent + plan) → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'mental_health', value: 'suicidal_intent' })])).toBe('ED_OR_911_GUIDANCE');
  });
});

describe('familymed-v1 — highest-value Tier-2 gates escalate to ED', () => {
  it('surgical abdomen / suspected AAA → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'symptom', value: 'rigid_abdomen' })])).toBe('ED_OR_911_GUIDANCE');
  });

  it('OB emergency (suspected ectopic) → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'symptom', value: 'ectopic_pregnancy' })])).toBe('ED_OR_911_GUIDANCE');
  });

  it('testicular torsion → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'symptom', value: 'testicular_torsion' })])).toBe('ED_OR_911_GUIDANCE');
  });

  it('cauda equina (saddle numbness + new incontinence) → ED_OR_911_GUIDANCE', () => {
    expect(act([fact({ factType: 'symptom', value: 'saddle_numbness' })])).toBe('ED_OR_911_GUIDANCE');
  });

  it('head injury WHILE on anticoagulation (two-condition AND) → ED_OR_911_GUIDANCE', () => {
    expect(
      act([
        fact({ factType: 'symptom', value: 'hit_head' }),
        fact({ factType: 'condition', value: 'on_blood_thinners' }),
      ]),
    ).toBe('ED_OR_911_GUIDANCE');
  });

  it('a head injury with NO anticoagulation context does NOT fire the anticoag gate', () => {
    // Only the hit_head fact, no blood-thinner condition → the two-condition AND must not match.
    const hits = evaluateRedFlags([fact({ factType: 'symptom', value: 'hit_head' })], BUNDLE.redFlagRules);
    expect(hits.hits.some((h) => h.ruleId === 'fm-headinjury-anticoag')).toBe(false);
  });
});

describe('familymed-v1 — the bundle ADDS escalation only; it never introduces false reassurance', () => {
  it('well viral illness (no gate fires) → engine risk path yields SELF_CARE, not an escalation', () => {
    const action = adjudicate({
      evidence: [
        fact({ factType: 'symptom', value: 'runny nose' }),
        fact({ factType: 'symptom', value: 'mild cough' }),
        fact({ factType: 'duration', value: '2 days' }),
      ],
      // high-confidence routine — the engine's own risk path (no red flag) decides SELF_CARE.
      riskEstimate: { ...lowRisk, pRoutine: 0.95, confidence: 0.9 },
      bundle: BUNDLE,
    }).decision.action;
    expect(action).toBe('SELF_CARE_INFO_ONLY');
  });

  it('mechanical back pain with NO neuro/systemic red flags does not fire any familymed gate', () => {
    const rf = evaluateRedFlags(
      [
        fact({ factType: 'symptom', value: 'lower back ache after lifting' }),
        fact({ factType: 'symptom', value: 'no leg weakness' }),
      ],
      BUNDLE.redFlagRules,
    );
    expect(rf.triggered).toBe(false);
  });

  it('EVERY familymed rule maps to an escalating action (ED or SAME_DAY) — never a downgrade', () => {
    const allowedEscalations = new Set(['ED_OR_911_GUIDANCE', 'SAME_DAY_REVIEW']);
    for (const rule of FAMILYMED_RED_FLAG_RULES) {
      expect(allowedEscalations.has(rule.action)).toBe(true);
      expect(ALLOWED_ACTIONS).toContain(rule.action);
    }
  });
});

describe('familymed-v1 — signed, checksum-verified, and resolvable through the engine registry', () => {
  const SECRET = 'x'.repeat(40);
  afterEach(() => vi.unstubAllEnvs());

  it('the unsigned bundle has a valid 64-hex checksum and verifies structurally', () => {
    expect(BUNDLE.metadata.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(BUNDLE.metadata.policyVersion).toBe(FAMILYMED_BUNDLE_VERSION);
    expect(BUNDLE.metadata.signedBy).toBe('Michael Hobbs, MD');
    expect(verifyPolicyBundle(BUNDLE).valid).toBe(true);
  });

  it('activeFamilymedBundle signs with VOICE_CONFIG_HMAC_SECRET when set', () => {
    vi.stubEnv('VOICE_CONFIG_HMAC_SECRET', SECRET);
    const signed = activeFamilymedBundle();
    expect(signed.metadata.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyBundleSignature(signed, SECRET)).toBe(true);
    expect(verifyPolicyBundle(signed, SECRET).valid).toBe(true);
  });

  it('a validly-signed familymed bundle adjudicates NORMALLY (chest-pressure ACS still → ED)', () => {
    vi.stubEnv('VOICE_CONFIG_HMAC_SECRET', SECRET);
    const trace = adjudicate({
      evidence: [
        fact({ factType: 'symptom', value: 'chest pressure' }),
        fact({ factType: 'symptom', value: 'radiation to jaw' }),
      ],
      riskEstimate: lowRisk,
      bundle: activeFamilymedBundle(),
    });
    expect(trace.bundle.signatureValid).toBe(true);
    expect(trace.decision.action).toBe('ED_OR_911_GUIDANCE');
  });

  it('is registered: getRegisteredBundle("familymed-v1") resolves it; it appears in the catalog', () => {
    const resolved = getRegisteredBundle(FAMILYMED_BUNDLE_VERSION);
    expect(resolved).not.toBeNull();
    expect(resolved!.metadata.policyVersion).toBe(FAMILYMED_BUNDLE_VERSION);
    expect(listRegisteredBundles().some((e) => e.version === FAMILYMED_BUNDLE_VERSION)).toBe(true);
    // The default stays registered + listed first.
    expect(listRegisteredBundles()[0].isDefault).toBe(true);
  });
});
