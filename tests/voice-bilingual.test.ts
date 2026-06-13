/**
 * Bilingual EN/ES is core (OSS law #5). Every AllowedAction must have policy-authored guidance in
 * BOTH languages, and the STT language + Aura TTS voice must switch per call language (es → a
 * Spanish Aura voice). (Lane G mandatory test.)
 */
import { describe, it, expect } from 'vitest';
import { ALLOWED_ACTIONS } from '@/engine/types';
import {
  guidanceFor,
  isTerminalEscalation,
  deepgramSttConfig,
  auraTtsModel,
} from '@/lib/voice/guidance';

describe('bilingual guidance — every action, both languages', () => {
  it('has non-empty EN and ES guidance for all 6 allowed actions', () => {
    for (const action of ALLOWED_ACTIONS) {
      const en = guidanceFor(action, 'en');
      const es = guidanceFor(action, 'es');
      expect(en.length).toBeGreaterThan(0);
      expect(es.length).toBeGreaterThan(0);
      // EN and ES must actually differ (not a copy-paste of one language).
      expect(en).not.toBe(es);
    }
  });

  it('the emergency action speaks 911 in both languages', () => {
    expect(guidanceFor('ED_OR_911_GUIDANCE', 'en')).toMatch(/9 1 1|911/);
    expect(guidanceFor('ED_OR_911_GUIDANCE', 'es')).toMatch(/9 1 1|911/);
  });

  it('flags terminal escalations that latch the model out', () => {
    expect(isTerminalEscalation('ED_OR_911_GUIDANCE')).toBe(true);
    expect(isTerminalEscalation('IMMEDIATE_CLINIC_CALLBACK')).toBe(true);
    expect(isTerminalEscalation('BLOCK_AND_HUMAN_HANDOFF')).toBe(true);
    expect(isTerminalEscalation('SELF_CARE_INFO_ONLY')).toBe(false);
    expect(isTerminalEscalation('ROUTINE_REVIEW')).toBe(false);
  });
});

describe('bilingual STT/TTS selection — per call language', () => {
  it('selects a Spanish STT language + a Spanish Aura voice for es calls', () => {
    expect(deepgramSttConfig('es').language).toBe('es');
    expect(auraTtsModel('es')).toMatch(/-es$/); // aura-2-<voice>-es
  });

  it('selects English STT + an English Aura voice for en calls', () => {
    expect(deepgramSttConfig('en').language).toBe('en-US');
    expect(auraTtsModel('en')).toMatch(/-en$/);
  });

  it('en and es resolve to DIFFERENT Aura voices', () => {
    expect(auraTtsModel('en')).not.toBe(auraTtsModel('es'));
  });
});
