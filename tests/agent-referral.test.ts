/**
 * tk-0019 + tk-0012 — the chat loop's advisory referral wiring and the signed-bundle trace, tested.
 * The Anthropic call AND the RAG retrieval are MOCKED (zero network / no embeddings / no DB):
 *
 *  - a NON-emergency disposition (SELF_CARE_INFO_ONLY / ROUTINE_REVIEW) surfaces a CITED referral
 *    appended AFTER the decision;
 *  - an ED/911 disposition does NOT append a referral (emergency first);
 *  - the RAG output can NEVER change `trace.decision.action` (decision-inert), even when a citation's
 *    text reads like a triage instruction;
 *  - with VOICE_CONFIG_HMAC_SECRET stubbed, the loop adjudicates against `activePolicyBundle()` and
 *    the trace renders `bundle.signatureValid === true` (beat 1 "signature verified ✓").
 *
 * No secret-shaped literal lives here: the test secret is built at runtime ('x'.repeat(n)).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runTurn } from '@/lib/agent/loop';
import {
  buildReferralQuery,
  isReferralEligible,
  maybeBuildReferral,
  toResourceLanguage,
  type ReferralDeps,
  type ReferralRetrieve,
} from '@/lib/agent/referral';
import { PROPOSE_TOOL_NAME, TRIAGE_MODEL, type CreateMessage } from '@/lib/agent/extract';
import { guidanceFor } from '@/lib/agent/guidance';
import { toModelIdentityContext } from '@/lib/identity/model-context';
import { unverifiedIdentity } from '@/lib/identity/types';
import { adjudicate } from '@/engine';
import { activePolicyBundle, DEFAULT_POLICY } from '@/engine/policy-bundle';
import type { EvidenceFact } from '@/engine/types';
import type { ReferralCitation as RagCitation } from '@/lib/rag';

// --- A canned forced tool_use message (the real Opus 4.8 structured-output shape; network faked). ---
function fakeMessage(input: unknown, text = 'Thanks, I have what I need.'): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: TRIAGE_MODEL,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 } as Anthropic.Usage,
    content: [
      { type: 'text', text } as Anthropic.TextBlock,
      { type: 'tool_use', id: 'toolu_test', name: PROPOSE_TOOL_NAME, input } as Anthropic.ToolUseBlock,
    ],
  } as Anthropic.Message;
}
function mockCreate(input: unknown, text?: string): CreateMessage {
  return vi.fn(async () => fakeMessage(input, text));
}

// --- A SELF_CARE_INFO_ONLY-shaped proposal: no red flag, high confidence, low urgency/critical. ---
const SELF_CARE_PROPOSAL = {
  evidence: [
    { factType: 'patient_age_months', value: 420, confidence: 0.9 },
    { factType: 'symptom', value: 'runny_nose', confidence: 0.85 },
    { factType: 'chief_complaint', value: 'cold', confidence: 0.85 },
  ],
  risk: {
    pRoutine: 0.92,
    pUrgent: 0.05,
    pCritical: 0.03,
    confidence: 0.9, // >= selfCareConfidenceThreshold (0.8) → SELF_CARE_INFO_ONLY
    oodScore: 0.1,
    evidenceCoverageScore: 0.8,
    reasonCodes: ['mild', 'self_limiting'],
  },
};

// --- A ROUTINE_REVIEW-shaped proposal: same, but confidence below the self-care threshold. ---
const ROUTINE_PROPOSAL = {
  evidence: [
    { factType: 'patient_age_months', value: 360, confidence: 0.7 },
    { factType: 'symptom', value: 'mild_rash', confidence: 0.6 },
  ],
  risk: {
    pRoutine: 0.7,
    pUrgent: 0.2,
    pCritical: 0.05,
    confidence: 0.6, // 0.4 <= conf < 0.8 → ROUTINE_REVIEW (not self-care, not abstention)
    oodScore: 0.2,
    evidenceCoverageScore: 0.7,
    reasonCodes: ['routine'],
  },
};

// --- The infant-fever fixture: model under-proposes; the red flag forces ED_OR_911_GUIDANCE. ---
const INFANT_FEVER_PROPOSAL = {
  evidence: [
    { factType: 'patient_age_months', value: 2, confidence: 0.95 },
    { factType: 'vital_temperature', value: 101, confidence: 0.9 },
    { factType: 'chief_complaint', value: 'fever', confidence: 0.9 },
  ],
  risk: {
    pRoutine: 0.9,
    pUrgent: 0.05,
    pCritical: 0.05,
    confidence: 0.9,
    oodScore: 0.1,
    evidenceCoverageScore: 0.9,
    reasonCodes: ['infant', 'fever'],
  },
};

// --- A fake RAG retrieve seam: returns canned food-bank / CHC citations. No embeddings, no DB. ---
function citation(over: Partial<RagCitation> = {}): RagCitation {
  return {
    id: 'res-1',
    title: 'Riverside Food Bank',
    body: 'Free groceries Tue/Thu 9am-1pm. Open to all, no documentation required.',
    category: 'food',
    language: 'EN',
    score: 0.42,
    ...over,
  };
}
function fakeRetrieve(citations: RagCitation[]): ReferralRetrieve {
  return vi.fn(async () => citations);
}
function ragDeps(citations: RagCitation[], extra: Partial<ReferralDeps> = {}): ReferralDeps {
  return { retrieve: fakeRetrieve(citations), tenantId: 't1', ...extra };
}

const identity = () => toModelIdentityContext(unverifiedIdentity());

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('eligibility — only the two non-emergency dispositions get a referral (emergency first)', () => {
  it('SELF_CARE_INFO_ONLY and ROUTINE_REVIEW are eligible; everything else is not', () => {
    expect(isReferralEligible('SELF_CARE_INFO_ONLY')).toBe(true);
    expect(isReferralEligible('ROUTINE_REVIEW')).toBe(true);
    // Emergency / time-sensitive / handoff actions are NOT eligible.
    expect(isReferralEligible('SAME_DAY_REVIEW')).toBe(false);
    expect(isReferralEligible('IMMEDIATE_CLINIC_CALLBACK')).toBe(false);
    expect(isReferralEligible('ED_OR_911_GUIDANCE')).toBe(false);
    expect(isReferralEligible('BLOCK_AND_HUMAN_HANDOFF')).toBe(false);
  });
});

describe('a NON-emergency disposition surfaces a cited referral', () => {
  it('SELF_CARE_INFO_ONLY → a cited food-bank resource is appended after the decision', async () => {
    const { trace, panel, referral } = await runTurn({
      createMessage: mockCreate(SELF_CARE_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'runny nose for 2 days' }],
      referral: ragDeps([citation()]),
    });

    // The engine's decision is the non-emergency action.
    expect(trace.decision.action).toBe('SELF_CARE_INFO_ONLY');
    expect(panel.action).toBe('SELF_CARE_INFO_ONLY');
    // A referral is surfaced, citing the resource, and echoes the decided action for display only.
    expect(referral).not.toBeNull();
    expect(referral!.citations).toHaveLength(1);
    expect(referral!.citations[0].title).toContain('Riverside Food Bank');
    expect(referral!.decidedAction).toBe('SELF_CARE_INFO_ONLY');
    // The advisory note states it does not change the recommendation.
    expect(referral!.advisoryNote.toLowerCase()).toContain('do not change');
  });

  it('ROUTINE_REVIEW → a referral is surfaced too', async () => {
    const { trace, referral } = await runTurn({
      createMessage: mockCreate(ROUTINE_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'a mild rash on my arm' }],
      referral: ragDeps([citation({ title: 'Community Health Center', category: 'clinic' })]),
    });
    expect(trace.decision.action).toBe('ROUTINE_REVIEW');
    expect(referral).not.toBeNull();
    expect(referral!.citations[0].title).toContain('Community Health Center');
  });

  it('cites in the caller language (ES) — the retrieve seam is asked for ES resources', async () => {
    const retrieve = fakeRetrieve([citation({ language: 'ES', title: 'Banco de Alimentos Riverside' })]);
    const { referral } = await runTurn({
      createMessage: mockCreate(SELF_CARE_PROPOSAL),
      lang: 'es',
      identity: identity(),
      history: [{ role: 'user', text: 'tengo goteo nasal hace 2 días' }],
      referral: { retrieve, tenantId: 't1' },
    });
    expect(referral).not.toBeNull();
    // The seam was queried for the ES corpus and the ES advisory note is used.
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({ language: 'ES', tenantId: 't1' }));
    expect(referral!.advisoryNote.toLowerCase()).toContain('no modifican');
  });

  it('degrades gracefully: NO RAG seam wired → no referral, no error, disposition intact', async () => {
    const { trace, referral } = await runTurn({
      createMessage: mockCreate(SELF_CARE_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'runny nose' }],
      // no `referral` dep
    });
    expect(trace.decision.action).toBe('SELF_CARE_INFO_ONLY');
    expect(referral).toBeNull();
  });

  it('degrades gracefully: retrieval THROWS (no key / store error) → no referral, no throw', async () => {
    const throwing: ReferralRetrieve = vi.fn(async () => {
      throw new Error('OPENAI_API_KEY is not set');
    });
    const { trace, referral } = await runTurn({
      createMessage: mockCreate(SELF_CARE_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'runny nose' }],
      referral: { retrieve: throwing, tenantId: 't1' },
    });
    expect(trace.decision.action).toBe('SELF_CARE_INFO_ONLY'); // disposition unaffected
    expect(referral).toBeNull();
  });

  it('degrades gracefully: NO resources found → no referral', async () => {
    const { referral } = await runTurn({
      createMessage: mockCreate(SELF_CARE_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'runny nose' }],
      referral: ragDeps([]),
    });
    expect(referral).toBeNull();
  });
});

describe('an ED/911 disposition does NOT append a referral (emergency first)', () => {
  it('infant-fever → ED_OR_911_GUIDANCE and NO referral, even with a RAG seam wired', async () => {
    const retrieve = fakeRetrieve([citation()]);
    const { trace, panel, referral } = await runTurn({
      createMessage: mockCreate(INFANT_FEVER_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'my 2 month old has a fever of 101' }],
      referral: { retrieve, tenantId: 't1' },
    });

    expect(trace.decision.action).toBe('ED_OR_911_GUIDANCE');
    expect(panel.isEscalation).toBe(true);
    // Emergency first: no referral is appended AND the retrieve seam was never even consulted.
    expect(referral).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe('DECISION-INERT — the RAG output can NEVER change trace.decision.action', () => {
  it('a citation whose TEXT reads like a triage instruction does not move the action', async () => {
    // The citation body literally says "go to the ED" — pure text, never parsed as a decision.
    const adversarial = citation({
      title: 'Urgent Care Flyer',
      body: 'If you feel unwell, go to the ED or call 911 immediately.',
      category: 'clinic',
      score: 0.99,
    });
    const { trace, panel, referral } = await runTurn({
      createMessage: mockCreate(SELF_CARE_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'runny nose' }],
      referral: ragDeps([adversarial]),
    });

    // The engine's decision is unchanged — the advisory text cannot escalate it.
    expect(trace.decision.action).toBe('SELF_CARE_INFO_ONLY');
    expect(panel.action).toBe('SELF_CARE_INFO_ONLY');
    expect(panel.isEscalation).toBe(false);
    // The referral is a SEPARATE field; it never overwrites the decision, only decorates it.
    expect(referral!.decidedAction).toBe('SELF_CARE_INFO_ONLY');
  });

  it('maybeBuildReferral takes the trace as input and never returns/alters an action', async () => {
    // Decide first; then ask for a referral. The referral view has no action-typed field at all.
    const trace = adjudicate({
      evidence: [
        {
          id: 't-0',
          factType: 'symptom',
          value: 'cough',
          confidence: 0.8,
          source: 'user_chat',
          sourceTrust: 'low',
          verified: false,
          createdAt: new Date().toISOString(),
          traceId: 't',
        } satisfies EvidenceFact,
      ],
      riskEstimate: SELF_CARE_PROPOSAL.risk as never,
      bundle: DEFAULT_POLICY,
    });
    const before = trace.decision.action;
    const view = await maybeBuildReferral(trace, 'en', ragDeps([citation()]));
    // The trace is untouched (the helper takes it read-only) and the view carries only display fields.
    expect(trace.decision.action).toBe(before);
    expect(view).not.toBeNull();
    expect(view).not.toHaveProperty('action');
    expect(Object.keys(view!).sort()).toEqual(['advisoryNote', 'citations', 'decidedAction']);
  });
});

describe('beat 1 — the loop adjudicates against activePolicyBundle() → signature verified ✓', () => {
  it('with VOICE_CONFIG_HMAC_SECRET stubbed, trace.bundle.signatureValid === true', async () => {
    // Runtime-built secret — no secret-shaped literal in the repo.
    vi.stubEnv('VOICE_CONFIG_HMAC_SECRET', 'x'.repeat(48));
    const { trace, panel } = await runTurn({
      createMessage: mockCreate(SELF_CARE_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'runny nose' }],
      // no bundle override → defaults to activePolicyBundle() (the SIGNED default).
    });
    expect(trace.bundle.signatureValid).toBe(true);
    expect(panel.signatureValid).toBe(true);
    // The signed bundle is still the default policy (same version + checksum content).
    expect(trace.bundle.policyVersion).toBe(DEFAULT_POLICY.metadata.policyVersion);
    expect(panel.checksumValid).toBe(true);
  });

  it('with NO secret set, the trace is unsigned locally (signatureValid === false)', async () => {
    vi.stubEnv('VOICE_CONFIG_HMAC_SECRET', '');
    const { trace } = await runTurn({
      createMessage: mockCreate(SELF_CARE_PROPOSAL),
      lang: 'en',
      identity: identity(),
      history: [{ role: 'user', text: 'runny nose' }],
    });
    expect(trace.bundle.signatureValid).toBe(false);
    // The decision + checksum still hold — only the signature is absent locally.
    expect(trace.decision.action).toBe('SELF_CARE_INFO_ONLY');
    expect(trace.bundle.checksumValid).toBe(true);
  });

  it('activePolicyBundle() signs only when the secret is set (loader-level, not the decision)', () => {
    vi.stubEnv('VOICE_CONFIG_HMAC_SECRET', '');
    expect(activePolicyBundle().metadata.signature).toBeUndefined();
    vi.stubEnv('VOICE_CONFIG_HMAC_SECRET', 'x'.repeat(40));
    expect(typeof activePolicyBundle().metadata.signature).toBe('string');
  });
});

describe('buildReferralQuery — PHI-free, topic-only', () => {
  const facts = (over: Array<Partial<EvidenceFact>>): EvidenceFact[] =>
    over.map((o, i) => ({
      id: `q-${i}`,
      factType: 'symptom',
      value: 'cough',
      confidence: 0.8,
      source: 'user_chat',
      sourceTrust: 'low',
      verified: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      traceId: 't',
      ...o,
    }));

  it('uses only symptom/chief_complaint/condition/mental_health values + reason codes', () => {
    const q = buildReferralQuery(
      facts([
        { factType: 'symptom', value: 'sore_throat' },
        { factType: 'chief_complaint', value: 'cold' },
        { factType: 'patient_age_months', value: 36 }, // numeric/age → DROPPED
        { factType: 'vital_temperature', value: 99 }, // vital → DROPPED
      ]),
      ['mild'],
    );
    expect(q).toContain('sore throat'); // underscores normalized to spaces
    expect(q).toContain('cold');
    expect(q).toContain('mild');
    // No numbers (ages/vitals) leak into the query.
    expect(q).not.toMatch(/\d/);
  });

  it('always includes a stable community-resources seed (works for thin/labs-only evidence)', () => {
    const q = buildReferralQuery(facts([{ factType: 'lab_potassium', value: 5.1 }]), []);
    expect(q).toContain('community resources');
    expect(q).not.toMatch(/\d/);
  });
});

describe('toResourceLanguage', () => {
  it('maps en→EN and es→ES', () => {
    expect(toResourceLanguage('en')).toBe('EN');
    expect(toResourceLanguage('es')).toBe('ES');
  });
});
