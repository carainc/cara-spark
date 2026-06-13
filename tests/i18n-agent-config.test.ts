import { describe, it, expect } from 'vitest';
import { en, es } from '@/lib/i18n';

/**
 * tk-0022 — bilingual EN/ES is a CORE requirement. The Dict type already enforces that en and es
 * share a structure at COMPILE time; this guards at RUNTIME that the new agent-config + landing
 * copy is actually translated (non-empty, and ES is not just a copy of EN for visible labels).
 */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

describe('i18n — agent-config + landing copy is present in both languages', () => {
  it('every agentConfig + landing string is non-empty in EN and ES', () => {
    const enFlat = flatten({ agentConfig: en.agentConfig, landing: en.landing });
    const esFlat = flatten({ agentConfig: es.agentConfig, landing: es.landing });
    const keys = Object.keys(enFlat);
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(enFlat[key]?.trim(), `EN ${key}`).toBeTruthy();
      expect(esFlat[key]?.trim(), `ES ${key}`).toBeTruthy();
    }
  });

  it('ES actually differs from EN for prose-heavy labels (not an untranslated stub)', () => {
    // Tab labels can legitimately coincide (e.g. "General"), so sample copy that MUST differ.
    expect(es.agentConfig.policies.subtitle).not.toBe(en.agentConfig.policies.subtitle);
    expect(es.landing.subhead).not.toBe(en.landing.subhead);
    expect(es.agentConfig.channels.didNote).not.toBe(en.agentConfig.channels.didNote);
  });

  it('the five config tabs are all labeled in both languages', () => {
    for (const tabs of [en.agentConfig.tabs, es.agentConfig.tabs]) {
      expect(Object.values(tabs).every((v) => v.trim().length > 0)).toBe(true);
      expect(Object.keys(tabs).sort()).toEqual(['channels', 'corpus', 'general', 'policies', 'preview']);
    }
  });
});
