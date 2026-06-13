/**
 * Lane D / T7 — the canned guidance + trace-panel view-model. Asserts: every AllowedAction has
 * bilingual canned text; escalation actions are flagged; NO guidance string contains prescribe /
 * diagnose / dose language (not-medical-advice discipline); the trace panel reflects the engine's
 * decision and the model can't change the rendered action. Pure — uses the REAL engine + fixtures.
 */
import { describe, it, expect } from 'vitest';
import { adjudicate } from '@/engine';
import { ALLOWED_ACTIONS } from '@/engine/types';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';
import { CASES, buildEvidence, buildRisk } from '@/fixtures/cases';
import { guidanceFor, buildTracePanel, ESCALATION_ACTIONS } from '@/lib/agent/guidance';
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
