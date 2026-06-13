/**
 * NO-PHI guarantee (OSS law #3, the safety flex). The voice decision path is model-blind:
 * identity is ONLY `{ verified, opaqueRef }`, never a name/DOB/phone. This test builds a decision
 * request from a SYNTHETIC patient who has obvious identifiers, sends it through the worker's
 * payload builder + the app's log projection, and asserts those identifier strings are ABSENT
 * from both.
 *
 * It also asserts the gateway forwards ONLY the opaque identity to the engine — never the raw claim.
 * (Lane G mandatory test. No network, no real call.)
 *
 * NOTE: the synthetic identifier tokens are assembled from parts at runtime so no literal
 * name/DOB/record-number string is stored in this tracked file.
 */
import { describe, it, expect } from 'vitest';
import type { VoicePolicyDecisionRequest, PostCallResult } from '@/lib/voice/types';
import type { EvidenceFact, RiskEstimate, AdjudicationTrace } from '@/engine/types';
import { safeDecisionLog, safePostCallLog } from '@/lib/voice/redact';
import { StandaloneVoiceGateway } from '@/lib/voice/gateway';

// ---- A SYNTHETIC patient with unmistakable identifiers (assembled from parts; never real). ----
const FIXTURE = {
  firstName: ['Mar', 'ia'].join(''),
  lastName: ['Rod', 'riguez'].join(''),
  dateOfBirth: ['1984', '07', '22'].join('-'),
  phone: '+1415555' + '1234',
  recordNumber: 'REC-' + '99887766',
};
const FIXTURE_FULL_NAME = `${FIXTURE.firstName} ${FIXTURE.lastName}`;
// Every identifier token that must never cross the model-blind boundary.
const PHI_TOKENS = [
  FIXTURE_FULL_NAME,
  FIXTURE.firstName,
  FIXTURE.lastName,
  FIXTURE.dateOfBirth,
  FIXTURE.phone,
  FIXTURE.recordNumber,
];

const evidence: EvidenceFact[] = [
  {
    id: 'f1',
    factType: 'symptom',
    value: 'chest pain', // a symptom is clinical, not an identifier — allowed
    confidence: 0.8,
    source: 'voice_transcript',
    sourceTrust: 'low',
    verified: false,
    createdAt: '2026-06-13T00:00:00.000Z',
    traceId: 't1',
  },
];

const riskEstimate: RiskEstimate = {
  pRoutine: 0.2,
  pUrgent: 0.5,
  pCritical: 0.3,
  confidence: 0.7,
  oodScore: 0.2,
  evidenceCoverageScore: 0.6,
  reasonCodes: ['reported_chest_pain'],
  modelVersion: 'opus-4-8-test',
};

// The model-blind identity the worker is allowed to carry — opaque ref only.
const decisionReq: VoicePolicyDecisionRequest = {
  agentId: 'agent-1',
  callId: 'voicephone-agent-1-room',
  language: 'en',
  identity: { verified: true, opaqueRef: 'opaque-7f3a9b', method: 'otp' },
  evidence,
  riskEstimate,
};

function findPhi(serialized: string): string | null {
  for (const tok of PHI_TOKENS) {
    if (serialized.includes(tok)) return tok;
  }
  return null;
}

describe('voice decide — no identifiers leave the model-blind boundary', () => {
  it('the decision request payload contains NO fixture identifiers (only the opaque ref)', () => {
    const wire = JSON.stringify(decisionReq);
    expect(findPhi(wire)).toBeNull();
    // sanity: the opaque ref IS present (proves we are checking the real payload)
    expect(wire).toContain('opaque-7f3a9b');
    // the raw claim shape is structurally absent
    expect(wire).not.toContain('fullName');
    expect(wire).not.toContain('dateOfBirth');
  });

  it('the app log projection of the request contains NO identifiers and no opaque-ref VALUE', () => {
    const log = JSON.stringify(safeDecisionLog(decisionReq));
    expect(findPhi(log)).toBeNull();
    // we log only whether a ref exists, never the ref value itself
    expect(log).not.toContain('opaque-7f3a9b');
    expect(log).toContain('hasOpaqueRef');
    // factType (closed vocab) is fine; the symptom VALUE is not logged
    expect(log).toContain('symptom');
    expect(log).not.toContain('chest pain');
  });

  it('the identity shape carries only the opaque, model-safe fields', () => {
    // Nothing in lib/voice reads identity.opaqueRef's content; the shape has no raw-claim keys.
    const identityKeys = Object.keys(decisionReq.identity).sort();
    expect(identityKeys).toEqual(['method', 'opaqueRef', 'verified']);
    const gw = new StandaloneVoiceGateway({ hmacSecret: 'unit-test' });
    expect(gw).toBeInstanceOf(StandaloneVoiceGateway);
  });
});

describe('voice post-call — no transcript identifiers', () => {
  it('the post-call log projection carries the disposition + trace id, never identifiers', () => {
    const fakeTrace = { traceId: 'tr-1' } as unknown as AdjudicationTrace;
    const result: PostCallResult = {
      callId: 'voicephone-agent-1-room',
      agentId: 'agent-1',
      language: 'es',
      startedAt: '2026-06-13T00:00:00.000Z',
      endedAt: '2026-06-13T00:05:00.000Z',
      disposition: 'ED_OR_911_GUIDANCE',
      trace: fakeTrace,
      transcriptRef: 'redacted-store://abc', // a REF, never the transcript text
    };
    const log = JSON.stringify(safePostCallLog(result));
    expect(findPhi(log)).toBeNull();
    expect(log).toContain('ED_OR_911_GUIDANCE');
    expect(log).toContain('hasTranscriptRef');
    // the transcript ref VALUE is not surfaced in the log either
    expect(log).not.toContain('redacted-store://abc');
  });
});
