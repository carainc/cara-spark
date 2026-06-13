/**
 * Lane D / T7 — THE THESIS, tested: the model PROPOSES typed evidence + a risk estimate; the
 * deterministic ENGINE decides; the model cannot soften a fired red flag; the model is blind to
 * identifiers. The Anthropic call is MOCKED (zero network) — we hand the loop a canned tool_use
 * response and assert the engine drives the disposition.
 *
 * Golden path: the infant-fever fixture ("2-month-old, fever 101") → evidence
 * {patient_age_months:2, vital_temperature:101} → adjudicate → ED_OR_911_GUIDANCE, with the red-flag
 * rule `infant-fever-floor`, crisis guidance, NO advice text, and an immovable escalation.
 */
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runTurn } from '@/lib/agent/loop';
import {
  parseProposal,
  proposeAssessment,
  buildSystemPrompt,
  PROPOSE_TOOL,
  PROPOSE_TOOL_NAME,
  TRIAGE_MODEL,
  type CreateMessage,
} from '@/lib/agent/extract';
import { guidanceFor } from '@/lib/agent/guidance';
import { toModelIdentityContext } from '@/lib/identity/model-context';
import { unverifiedIdentity } from '@/lib/identity/types';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';

// --- Synthetic identifiers (NOT real PHI; non-key-shaped). Asserted grep-absent from model payload.
const SYNTH_NAME = 'Jordan Testcase';
const SYNTH_DOB = '1990-02-14';
const SYNTH_PHONE = '+15551230000';
const SYNTH_EMAIL = 'jordan.testcase@example.test';
const SYNTH_IDENTIFIERS = [SYNTH_NAME, SYNTH_DOB, SYNTH_PHONE, SYNTH_EMAIL];

/**
 * A fake Anthropic message carrying a single forced tool_use of propose_assessment. This is exactly
 * the structured shape the real Opus 4.8 call returns under tool_choice — so the parser/loop path is
 * the real one; only the network is faked.
 */
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
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: PROPOSE_TOOL_NAME,
        input,
      } as Anthropic.ToolUseBlock,
    ],
  } as Anthropic.Message;
}

/** The model UNDER-proposes risk for the infant — exactly the fixture's adversarial case. */
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

function mockCreate(input: unknown, text?: string): CreateMessage {
  return vi.fn(async () => fakeMessage(input, text));
}

describe('the tool the model is forced to call', () => {
  it('propose_assessment has NO field for an AllowedAction — the model cannot pick the disposition', () => {
    const schema = PROPOSE_TOOL.input_schema as {
      properties: Record<string, { properties?: Record<string, unknown> }>;
    };
    // Top-level fields are evidence + risk ONLY — there is no `action`/`disposition` field to fill.
    expect(Object.keys(schema.properties).sort()).toEqual(['evidence', 'risk']);
    // Nor is there one nested inside the risk object.
    const riskFields = Object.keys(schema.properties.risk.properties ?? {});
    expect(riskFields).not.toContain('action');
    expect(riskFields).not.toContain('disposition');
    expect(riskFields).not.toContain('allowedAction');
    // (The tool DESCRIPTION intentionally names "disposition" to tell the model the engine decides it
    //  — that is the thesis stated to the model, not a field the model can set.)
  });
});

describe('infant-fever golden path — model proposes, engine decides (red flag dominates)', () => {
  it('routes {age:2, temp:101} → ED_OR_911_GUIDANCE via infant-fever-floor, ignoring the model risk', async () => {
    const create = mockCreate(INFANT_FEVER_PROPOSAL);
    const result = await runTurn({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'my 2 month old has a fever of 101' }],
    });

    // Engine's decision is binding — and it's the emergency action, NOT the model's "routine".
    expect(result.trace.decision.action).toBe('ED_OR_911_GUIDANCE');
    expect(result.panel.action).toBe('ED_OR_911_GUIDANCE');

    // The red-flag rule fired — the model's low pCritical was never consulted.
    expect(result.panel.redFlagFired).toBe(true);
    expect(result.panel.rules.map((r) => r.ruleId)).toContain('infant-fever-floor');

    // Typed evidence the model extracted is present in the trace.
    const facts = Object.fromEntries(result.trace.evidence.map((e) => [e.factType, e.value]));
    expect(facts.patient_age_months).toBe(2);
    expect(facts.vital_temperature).toBe(101);
  });

  it('guidance is the canned ED/911 crisis text and contains NO clinical advice text', async () => {
    const create = mockCreate(INFANT_FEVER_PROPOSAL);
    const { panel } = await runTurn({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'fever in my baby' }],
    });

    expect(panel.isEscalation).toBe(true);
    // Crisis resources / emergency action present:
    expect(panel.guidance).toMatch(/911|emergency department/i);
    // NOT-medical-advice discipline: the canned guidance must not prescribe / diagnose / dose.
    const forbidden = ['take ', 'dose', 'prescrib', 'diagnos', 'mg', 'medication'];
    for (const f of forbidden) expect(panel.guidance.toLowerCase()).not.toContain(f);
  });

  it('the model CANNOT soften the fired red flag — even if it returns reassuring prose', async () => {
    // Model prose says "probably fine"; engine still escalates and that prose is NOT the guidance.
    const create = mockCreate(INFANT_FEVER_PROPOSAL, 'It is probably nothing serious, just monitor at home.');
    const { panel, assistantText } = await runTurn({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'baby fever' }],
    });

    expect(panel.action).toBe('ED_OR_911_GUIDANCE');
    // The binding guidance is the engine's canned escalation, never the model's reassurance.
    expect(panel.guidance).toBe(guidanceFor('ED_OR_911_GUIDANCE', 'en'));
    expect(panel.guidance).not.toContain('monitor at home');
    // The model's reassurance is only the chat bubble, clearly separated from the decision.
    expect(assistantText).toContain('monitor at home');
  });

  it('replies bilingually — ES escalation guidance is the Spanish canned text', async () => {
    const create = mockCreate(INFANT_FEVER_PROPOSAL);
    const { panel } = await runTurn({
      createMessage: create,
      lang: 'es',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'mi bebé de 2 meses tiene fiebre de 101' }],
    });
    expect(panel.action).toBe('ED_OR_911_GUIDANCE');
    expect(panel.guidance).toBe(guidanceFor('ED_OR_911_GUIDANCE', 'es'));
    expect(panel.guidance).toMatch(/911|sala de emergencias/i);
  });
});

describe('model-blindness — no name/DOB ever reaches the assembled model payload', () => {
  it('the system prompt + sent messages contain NONE of the synthetic identifiers', async () => {
    // The model-safe identity block carries only { verified, opaqueRef, method }.
    const identity = toModelIdentityContext({ verified: true, opaqueRef: 'idr_opaque_123', method: 'otp' });

    // Capture exactly what the loop sends to the SDK.
    let captured: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const create: CreateMessage = vi.fn(async (params) => {
      captured = params;
      return fakeMessage(INFANT_FEVER_PROPOSAL);
    });

    // The patient message is symptom text only — the app never forwards identifiers, but even if a
    // user typed one, it would be their message, not something we attach. Here we assert OUR payload.
    await proposeAssessment({
      createMessage: create,
      lang: 'en',
      identity,
      history: [{ role: 'user', text: 'my 2 month old has a fever of 101' }],
    });

    const payload = JSON.stringify({ system: captured?.system, messages: captured?.messages });
    for (const id of SYNTH_IDENTIFIERS) {
      expect(payload).not.toContain(id);
    }
    // Positive control: the opaque ref IS present (we are testing a real, populated payload).
    expect(payload).toContain('idr_opaque_123');
  });

  it('buildSystemPrompt instructs the model never to ask for identifiers and carries no PHI', () => {
    const prompt = buildSystemPrompt('en', toModelIdentityContext(unverifiedIdentity()));
    expect(prompt.toLowerCase()).toContain('never ask for');
    expect(prompt.toLowerCase()).toContain('date of');
    for (const id of SYNTH_IDENTIFIERS) expect(prompt).not.toContain(id);
  });
});

describe('agent customization (tk-0015) — persona/instructions tune TONE only, never the engine', () => {
  const base = () => buildSystemPrompt('en', toModelIdentityContext(unverifiedIdentity()));

  it('empty customization → byte-for-byte the base prompt (no behavior change when unset)', () => {
    const identity = toModelIdentityContext(unverifiedIdentity());
    expect(buildSystemPrompt('en', identity, {})).toBe(base());
    // Whitespace-only / null fields also collapse to the base prompt — nothing is appended.
    expect(
      buildSystemPrompt('en', identity, {
        persona: '   ',
        systemPromptExtra: '',
        additionalInstructions: null,
      }),
    ).toBe(base());
    expect(buildSystemPrompt('en', identity, undefined)).toBe(base());
  });

  it('persona + additionalInstructions appear in the built prompt, AFTER the hard rules', () => {
    const persona = 'Warm, plain-language, reassuring to a worried caregiver.';
    const additionalInstructions = 'Greet in the caller’s language; avoid medical jargon.';
    const prompt = buildSystemPrompt('en', toModelIdentityContext(unverifiedIdentity()), {
      persona,
      additionalInstructions,
    });

    // The custom text is present...
    expect(prompt).toContain(persona);
    expect(prompt).toContain(additionalInstructions);
    // ...and it comes AFTER the non-negotiable rules (the engine-owns-the-decision sentence).
    const hardRuleIdx = prompt.indexOf('separate deterministic safety engine makes every disposition');
    expect(hardRuleIdx).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf(persona)).toBeGreaterThan(hardRuleIdx);
    expect(prompt.indexOf(additionalInstructions)).toBeGreaterThan(hardRuleIdx);
  });

  it('systemPromptExtra is appended verbatim, also after the rules', () => {
    const systemPromptExtra = 'Use short sentences. Acknowledge worry before the next question.';
    const prompt = buildSystemPrompt('en', toModelIdentityContext(unverifiedIdentity()), {
      systemPromptExtra,
    });
    expect(prompt).toContain(systemPromptExtra);
    const rulesIdx = prompt.indexOf('Never state or imply');
    expect(prompt.indexOf(systemPromptExtra)).toBeGreaterThan(rulesIdx);
  });

  it('the hard no-disposition + model-blindness rules SURVIVE any customization', () => {
    // Even a persona that *tries* to override the engine cannot strip the invariants.
    const prompt = buildSystemPrompt('en', toModelIdentityContext(unverifiedIdentity()), {
      persona: 'Be decisive: tell the patient if this is an emergency and what to do.',
      additionalInstructions: 'You may decide the urgency yourself.',
    });
    const lower = prompt.toLowerCase();
    // No-disposition / no-urgency invariant intact:
    expect(prompt).toContain('a separate deterministic safety engine makes every disposition');
    expect(lower).toContain('never state or imply');
    // Model-blindness intact:
    expect(lower).toContain('never ask for');
    expect(lower).toContain('date of');
    // And a guardrail explicitly subordinates the customization to the rules.
    expect(lower).toContain('only your tone');
    expect(lower).toMatch(/ignore that part/i);
    // No PHI leaks via the persona path either.
    for (const id of SYNTH_IDENTIFIERS) expect(prompt).not.toContain(id);
  });

  it('proposeAssessment threads the customization into the system prompt it sends', async () => {
    let captured: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const create: CreateMessage = vi.fn(async (params) => {
      captured = params;
      return fakeMessage(INFANT_FEVER_PROPOSAL);
    });
    await proposeAssessment({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'sore throat for a day' }],
      custom: { persona: 'Calm and concise.' },
    });
    expect(String(captured?.system)).toContain('Calm and concise.');
    // Threading the persona must NOT re-introduce `thinking` under the forced tool call (prod 400).
    expect((captured as Record<string, unknown> | undefined)?.thinking).toBeUndefined();
  });

  it('runTurn passes custom through and the engine STILL decides (persona cannot soften a red flag)', async () => {
    let captured: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const create: CreateMessage = vi.fn(async (params) => {
      captured = params;
      return fakeMessage(INFANT_FEVER_PROPOSAL, 'It is probably nothing serious.');
    });
    const { panel } = await runTurn({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'my 2 month old has a fever of 101' }],
      custom: { persona: 'Be soothing; reassure the parent it is fine.' },
    });
    // The persona reached the model...
    expect(String(captured?.system)).toContain('Be soothing');
    // ...but the deterministic engine still escalates the infant fever — tone did not move the decision.
    expect(panel.action).toBe('ED_OR_911_GUIDANCE');
    expect(panel.redFlagFired).toBe(true);
  });
});

describe('the model call is API-valid — forced tool_choice WITHOUT thinking (regression: prod 400)', () => {
  it('forces the propose tool and sends NO `thinking` (the API rejects the combination)', async () => {
    let captured: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const create: CreateMessage = vi.fn(async (params) => {
      captured = params;
      return fakeMessage(INFANT_FEVER_PROPOSAL);
    });
    await proposeAssessment({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'sore throat for a day' }],
    });
    // Structured output via forced tool use...
    expect(captured?.tool_choice).toEqual({ type: 'tool', name: PROPOSE_TOOL_NAME });
    // ...so `thinking` MUST be absent — the API 400s ("Thinking may not be enabled when tool_choice
    // forces tool use"), which silently broke every chat turn in prod. This is the regression guard.
    expect((captured as Record<string, unknown> | undefined)?.thinking).toBeUndefined();
    expect(captured?.model).toBe(TRIAGE_MODEL);
  });
});

describe('parseProposal — defensive parsing of the model tool_use', () => {
  it('throws when the model fails to call the tool (cannot adjudicate without typed evidence)', () => {
    const noTool = {
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: TRIAGE_MODEL,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: 'hello' }],
    } as Anthropic.Message;
    expect(() => parseProposal(noTool, { traceId: 't', source: 'user_chat' })).toThrow(/propose_assessment/);
  });

  it('stamps source=user_chat (low trust) and the model version onto every fact', () => {
    const out = parseProposal(fakeMessage(INFANT_FEVER_PROPOSAL), { traceId: 'trc', source: 'user_chat' });
    expect(out.evidence.every((e) => e.source === 'user_chat')).toBe(true);
    expect(out.evidence.every((e) => e.sourceTrust === 'low')).toBe(true);
    expect(out.evidence.every((e) => e.traceId === 'trc')).toBe(true);
    expect(out.riskEstimate.modelVersion).toBe(TRIAGE_MODEL);
  });
});

describe('multi-turn (tk-0029) — runTurn surfaces turnMode end-to-end (model → engine → panel)', () => {
  it('a thin, low-coverage proposal → panel.turnMode "converse" (keep gathering info, no scary card)', async () => {
    // The model proposes one vague symptom with LOW evidence coverage → the engine BLOCKs for
    // insufficiency (no red flag). The panel must say CONVERSE so the UI keeps the conversation going.
    const create = mockCreate(
      {
        evidence: [{ factType: 'symptom', value: 'not_feeling_well', confidence: 0.5 }],
        risk: {
          pRoutine: 0.6,
          pUrgent: 0.2,
          pCritical: 0.05,
          confidence: 0.7,
          oodScore: 0.2,
          evidenceCoverageScore: 0.2, // < reviewThreshold 0.4 → evidence-insufficiency block
          reasonCodes: ['vague'],
        },
      },
      'Can you tell me how long this has been going on, and how bad it feels?',
    );
    const { panel, trace, assistantText } = await runTurn({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: "i don't feel great" }],
    });
    expect(trace.decision.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
    expect(trace.redFlagResult.triggered).toBe(false);
    expect(panel.turnMode).toBe('converse');
    // The model's follow-up question is available for the chat bubble (the conversation continues).
    expect(assistantText).toContain('how long');
  });

  it('an emergency (infant fever red flag) → panel.turnMode "present" (ALWAYS surfaces immediately)', async () => {
    const create = mockCreate(INFANT_FEVER_PROPOSAL);
    const { panel } = await runTurn({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'my 2 month old has a fever of 101' }],
    });
    // The safety thesis through the full loop: an emergency is presented, never deferred to "converse".
    expect(panel.action).toBe('ED_OR_911_GUIDANCE');
    expect(panel.redFlagFired).toBe(true);
    expect(panel.turnMode).toBe('present');
  });
});

describe('a benign case flows to a non-escalation action', () => {
  it('common-cold-shaped proposal → SELF_CARE_INFO_ONLY (engine, not model, decides)', async () => {
    const create = mockCreate({
      evidence: [
        { factType: 'patient_age_months', value: 420, confidence: 0.9 },
        { factType: 'symptom', value: 'runny_nose', confidence: 0.8 },
      ],
      risk: {
        pRoutine: 0.92,
        pUrgent: 0.05,
        pCritical: 0.03,
        confidence: 0.85,
        oodScore: 0.1,
        evidenceCoverageScore: 0.8,
        reasonCodes: ['mild'],
      },
    });
    const { panel } = await runTurn({
      createMessage: create,
      lang: 'en',
      identity: toModelIdentityContext(unverifiedIdentity()),
      history: [{ role: 'user', text: 'runny nose for 2 days' }],
    });
    expect(panel.action).toBe('SELF_CARE_INFO_ONLY');
    expect(panel.isEscalation).toBe(false);
    expect(panel.redFlagFired).toBe(false);
    // checksum verifies against the default bundle (provable trace).
    expect(panel.checksumValid).toBe(true);
    expect(panel.bundleVersion).toBe(DEFAULT_POLICY.metadata.policyVersion);
  });
});
