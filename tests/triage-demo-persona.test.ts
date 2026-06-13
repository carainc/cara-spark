/**
 * PART A guarantee (tk-0025): the Triage Demo persona is TONE-ONLY. It encodes the protocol's
 * CONVERSATIONAL scaffolding (Phases 1–3) and reinforces the thesis (the model only PROPOSES, stays
 * model-blind) — but it carries NO disposition logic. The disposition thresholds
 * (er_911/er_drive/needs_review/home_care) live exclusively in the signed familymed-v1 bundle. This
 * test fails loudly if a future edit leaks a decision rule into the persona.
 */
import { describe, it, expect } from 'vitest';
import { TRIAGE_DEMO_PERSONA, TRIAGE_DEMO_ADDITIONAL_INSTRUCTIONS } from '@/db/triage-demo-persona';
import { buildSystemPrompt } from '@/lib/agent/extract';
import { unverifiedIdentity } from '@/lib/identity/types';
import { toModelIdentityContext } from '@/lib/identity/model-context';

const PERSONA_TEXT = `${TRIAGE_DEMO_PERSONA}\n${TRIAGE_DEMO_ADDITIONAL_INSTRUCTIONS}`.toLowerCase();

describe('Triage Demo persona — conversational scaffolding present (Phases 1–3)', () => {
  it('Phase 1: warm anchor, the pivot, "Let\'s" wayfinding, and the baseline question', () => {
    const p = TRIAGE_DEMO_PERSONA.toLowerCase();
    expect(p).toContain("worth taking seriously"); // warm reflective anchor naming the symptom
    expect(p).toContain('what worries you most'); // the pivot to assessment
    expect(p).toContain("let's"); // collaborative wayfinding
    expect(p).toContain('baseline'); // what's different from baseline
    expect(p).toContain('one'); // one question at a time when terse/breathless
  });

  it('Phase 2: confirms subjective→observable using the protocol question framings', () => {
    // chest pain → radiation/sweat/exertion; breathing → full sentence/blue; dizzy → spinning/faint;
    // weak/numb → one side/arms-up/speech; headache → thunderclap-seconds; bleeding → coffee-ground/tarry.
    expect(PERSONA_TEXT).toContain('jaw');
    expect(PERSONA_TEXT).toContain('exertion');
    expect(PERSONA_TEXT).toContain('full sentence');
    expect(PERSONA_TEXT).toContain('spinning');
    expect(PERSONA_TEXT).toContain('both arms');
    expect(PERSONA_TEXT).toContain('thunderclap');
    expect(PERSONA_TEXT).toContain('coffee-ground');
    expect(PERSONA_TEXT).toContain('blood thinners');
  });

  it('Phase 3: a sentinel check (name 2–3 dangerous conditions and rule them out)', () => {
    expect(PERSONA_TEXT).toContain('sentinel check');
    expect(PERSONA_TEXT).toContain('dangerous conditions');
  });

  it('reinforces the thesis: the model only PROPOSES and stays model-blind', () => {
    expect(PERSONA_TEXT).toContain('propose');
    expect(PERSONA_TEXT).toContain('no name'); // model-blind
    expect(PERSONA_TEXT).toContain('engine'); // the engine decides
  });
});

describe('Triage Demo persona — contains NO disposition logic (the split is honored)', () => {
  // The persona must never name a disposition/level or a clinical threshold — those are the engine's.
  const FORBIDDEN = [
    'er_911',
    'er_drive',
    'needs_review',
    'home_care',
    'self_care_info_only',
    'same_day_review',
    'ed_or_911',
    'immediate_clinic_callback',
    'call 911',
    'go to the er',
    'go to the ed',
    'disposition is',
    'triage level',
  ];

  it('names no disposition token / level / "call 911" instruction', () => {
    for (const token of FORBIDDEN) {
      expect(PERSONA_TEXT).not.toContain(token);
    }
  });

  it('explicitly tells the model NOT to choose or hint at what the patient should do', () => {
    expect(PERSONA_TEXT).toContain('never choose');
    expect(PERSONA_TEXT).toContain('never state or imply');
  });
});

describe('buildSystemPrompt keeps the hard rules ahead of the persona (guardrail intact)', () => {
  it('appends the persona AFTER the non-negotiable hard rules + guardrail line', () => {
    const prompt = buildSystemPrompt('en', toModelIdentityContext(unverifiedIdentity()), {
      persona: TRIAGE_DEMO_PERSONA,
      additionalInstructions: TRIAGE_DEMO_ADDITIONAL_INSTRUCTIONS,
    });
    const hardRuleIdx = prompt.indexOf('you do NOT decide what the patient should do next');
    const guardrailIdx = prompt.indexOf('adjusts ONLY your tone');
    const personaIdx = prompt.indexOf('Persona / tone:');
    expect(hardRuleIdx).toBeGreaterThanOrEqual(0);
    expect(guardrailIdx).toBeGreaterThan(hardRuleIdx);
    expect(personaIdx).toBeGreaterThan(guardrailIdx);
  });
});
