import { describe, it, expect } from 'vitest';
import {
  isAIGeneratedProse,
  getSourceTrust,
  extractSingleFact,
  extractEvidence,
  type RawEvidenceInput,
} from '@/engine/evidence';
import { DEFAULT_SOURCE_TRUST, evidenceFactSchema } from '@/engine/types';

const OPTS = { traceId: 'trace_1', policyVersion: 'v1' };

describe('evidence — isAIGeneratedProse (the model-blind boundary, FR-1)', () => {
  it('non-strings are never prose', () => {
    expect(isAIGeneratedProse(42)).toBe(false);
    expect(isAIGeneratedProse({ a: 1 })).toBe(false);
    expect(isAIGeneratedProse(undefined)).toBe(false);
  });

  it('short strings are allowed (structured values, not prose)', () => {
    expect(isAIGeneratedProse('fever')).toBe(false);
    expect(isAIGeneratedProse('based on')).toBe(false); // matches a pattern but < 50 chars
  });

  it('long model-prose-shaped strings are rejected', () => {
    expect(
      isAIGeneratedProse('Based on the symptoms described, the patient likely has a viral infection requiring rest.'),
    ).toBe(true);
    expect(
      isAIGeneratedProse('In my clinical opinion this presentation is consistent with a routine respiratory issue.'),
    ).toBe(true);
  });

  it('long non-prose strings are allowed', () => {
    expect(
      isAIGeneratedProse('temperature 101.2 F measured orally at home twice over the past two hours by a caregiver'),
    ).toBe(false);
  });
});

describe('evidence — getSourceTrust', () => {
  it('returns the default trust for a source', () => {
    expect(getSourceTrust('user_chat')).toBe(DEFAULT_SOURCE_TRUST.user_chat);
    expect(getSourceTrust('ehr')).toBe('high');
  });
  it('honors an override', () => {
    expect(getSourceTrust('user_chat', { user_chat: 'high' })).toBe('high');
  });
});

describe('evidence — extractSingleFact', () => {
  it('drops AI prose (returns null)', () => {
    const input: RawEvidenceInput = {
      source: 'user_chat',
      factType: 'symptom',
      value: 'Based on the patient may have something serious going on here for sure today.',
    };
    expect(extractSingleFact(input, OPTS)).toBeNull();
  });

  it('mints a schema-valid fact with defaulted confidence + trust', () => {
    const fact = extractSingleFact({ source: 'ehr', factType: 'vital_temperature', value: 101 }, OPTS);
    expect(fact).not.toBeNull();
    expect(evidenceFactSchema.safeParse(fact).success).toBe(true);
    expect(fact!.sourceTrust).toBe('high'); // ehr default
    expect(fact!.confidence).toBeGreaterThan(0);
    expect(fact!.verified).toBe(false);
    expect(fact!.traceId).toBe('trace_1');
    expect(fact!.policyVersionSeen).toBe('v1');
  });

  it('clamps confidence into [0,1]', () => {
    expect(
      extractSingleFact({ source: 'user_chat', factType: 'symptom', value: 'x', confidence: 5 }, OPTS)!.confidence,
    ).toBe(1);
    expect(
      extractSingleFact({ source: 'user_chat', factType: 'symptom', value: 'x', confidence: -3 }, OPTS)!.confidence,
    ).toBe(0);
  });

  it('honors explicit sourceTrust + verified', () => {
    const fact = extractSingleFact(
      { source: 'user_chat', factType: 'symptom', value: 'fever', sourceTrust: 'high', verified: true },
      OPTS,
    );
    expect(fact!.sourceTrust).toBe('high');
    expect(fact!.verified).toBe(true);
  });
});

describe('evidence — extractEvidence (batch keeps facts, counts drops)', () => {
  it('keeps valid facts and counts dropped prose', () => {
    const inputs: RawEvidenceInput[] = [
      { source: 'user_chat', factType: 'symptom', value: 'fever' },
      {
        source: 'user_chat',
        factType: 'note',
        value: 'Based on the patient seems to likely have a condition worth reviewing in detail.',
      }, // prose → dropped
      { source: 'ehr', factType: 'vital_temperature', value: 101 },
    ];
    const { facts, droppedCount } = extractEvidence(inputs, OPTS);
    expect(facts).toHaveLength(2);
    expect(droppedCount).toBe(1);
  });
});
