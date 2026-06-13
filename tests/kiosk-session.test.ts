/**
 * Kiosk lane (T16 / CAR-2395) — THE THESIS on a one-button box, tested. The kiosk adds NO triage
 * logic: it bridges into the SAME agent loop + deterministic engine. We assert:
 *   1. a kiosk session adjudicates via the ENGINE — a red-flag fixture (infant fever) speaks the
 *      ED/911 escalation, with the model's reassurance discarded (model proposes, engine decides);
 *   2. device-token verify REJECTS a forged / tampered / cross-agent token (fail-closed);
 *   3. the session is ANONYMOUS / model-blind — no identity reaches the assembled model payload.
 *
 * The single Anthropic call is MOCKED (zero network) — exactly the voice/chat lane pattern.
 */
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runKioskSession, type KioskAuditSink } from '@/lib/kiosk';
import {
  mintDeviceToken,
  verifyDeviceToken,
  mintDeviceId,
  KIOSK_TOKEN_PREFIX,
} from '@/lib/kiosk/device-token';
import { spokenDisclaimer, spokenGuidance } from '@/lib/kiosk/spoken';
import { PROPOSE_TOOL_NAME, TRIAGE_MODEL, type CreateMessage } from '@/lib/agent/extract';

// --- Synthetic identifiers (NOT real PHI; non-key-shaped). Asserted grep-absent from the payload.
const SYNTH_NAME = 'Jordan Testcase';
const SYNTH_DOB = '1990-02-14';
const SYNTH_PHONE = '+15551230000';
const SYNTH_IDENTIFIERS = [SYNTH_NAME, SYNTH_DOB, SYNTH_PHONE];

// A non-secret-shaped HMAC secret for the token tests (no secret-shaped literals — repeat-char).
const TEST_SECRET = 'x'.repeat(48);

/** A fake Anthropic message carrying the single forced propose_assessment tool_use. */
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

/** The model UNDER-proposes risk for the infant — the engine's red flag must still dominate. */
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

const mockCreate = (input: unknown, text?: string): CreateMessage => vi.fn(async () => fakeMessage(input, text));
const silentLog = () => {};

describe('kiosk session adjudicates via the engine — red flag → spoken ED/911 escalation', () => {
  it('routes the infant-fever utterance to ED_OR_911_GUIDANCE and SPEAKS the canned escalation', async () => {
    const res = await runKioskSession(
      { agentId: 'demo', lang: 'en', utterance: 'my 2 month old has a fever of 101' },
      { createMessage: mockCreate(INFANT_FEVER_PROPOSAL), log: silentLog },
    );

    // The ENGINE decided — and it is the emergency action, NOT the model's "routine".
    expect(res.action).toBe('ED_OR_911_GUIDANCE');
    expect(res.isEscalation).toBe(true);
    expect(res.trace.redFlagResult.triggered).toBe(true);
    expect(res.trace.redFlagResult.hits.map((h) => h.ruleId)).toContain('infant-fever-floor');

    // What the box SPEAKS is the verbatim, policy-authored line — TTS-shaped (9 1 1 spelled out).
    expect(res.spoken).toBe(spokenGuidance('ED_OR_911_GUIDANCE', 'en'));
    expect(res.spoken).toMatch(/9 1 1|emergency room/i);

    // An opaque, ephemeral session ref is minted (PHI-free) — no account, no identifier.
    expect(res.sessionRef.startsWith('kss_')).toBe(true);
  });

  it('the model CANNOT soften the fired red flag — reassuring prose is never spoken', async () => {
    const res = await runKioskSession(
      { agentId: 'demo', lang: 'en', utterance: 'baby fever' },
      { createMessage: mockCreate(INFANT_FEVER_PROPOSAL, 'It is probably nothing, just monitor at home.'), log: silentLog },
    );
    expect(res.action).toBe('ED_OR_911_GUIDANCE');
    expect(res.spoken).not.toContain('monitor at home');
    expect(res.spoken).toBe(spokenGuidance('ED_OR_911_GUIDANCE', 'en'));
  });

  it('speaks the Spanish escalation for a Spanish utterance (bilingual EN/ES is core)', async () => {
    const res = await runKioskSession(
      { agentId: 'demo', lang: 'es', utterance: 'mi bebé de 2 meses tiene fiebre de 101' },
      { createMessage: mockCreate(INFANT_FEVER_PROPOSAL), log: silentLog },
    );
    expect(res.action).toBe('ED_OR_911_GUIDANCE');
    expect(res.spoken).toBe(spokenGuidance('ED_OR_911_GUIDANCE', 'es'));
    expect(res.spoken).toMatch(/9 1 1|sala de emergencias/i);
  });

  it('a benign utterance flows to a non-escalation spoken line (engine, not model, decides)', async () => {
    const benign = {
      evidence: [
        { factType: 'patient_age_months', value: 420, confidence: 0.9 },
        { factType: 'symptom', value: 'runny_nose', confidence: 0.8 },
      ],
      risk: { pRoutine: 0.92, pUrgent: 0.05, pCritical: 0.03, confidence: 0.85, oodScore: 0.1, evidenceCoverageScore: 0.8, reasonCodes: ['mild'] },
    };
    const res = await runKioskSession(
      { agentId: 'demo', lang: 'en', utterance: 'runny nose for 2 days' },
      { createMessage: mockCreate(benign), log: silentLog },
    );
    expect(res.action).toBe('SELF_CARE_INFO_ONLY');
    expect(res.isEscalation).toBe(false);
    expect(res.trace.redFlagResult.triggered).toBe(false);
  });

  it('passes the session to the no-PHI audit sink with channel=KIOSK and the opaque ref only', async () => {
    const record: KioskAuditSink['record'] = vi.fn(async () => {});
    const audit: KioskAuditSink = { record };
    const res = await runKioskSession(
      { agentId: 'demo', lang: 'es', utterance: 'baby fever' },
      { createMessage: mockCreate(INFANT_FEVER_PROPOSAL), audit, log: silentLog },
    );
    expect(record).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(record).mock.calls[0]![0];
    expect(arg.channel).toBe('KIOSK');
    expect(arg.language).toBe('ES');
    expect(arg.identityRef).toBe(res.sessionRef); // opaque, PHI-free
    expect(arg.traces).toHaveLength(1);
  });
});

describe('device-token verify rejects a forged token (fail-closed)', () => {
  const agentId = 'agent-123';
  const deviceId = mintDeviceId();
  const token = mintDeviceToken({ agentId, deviceId }, TEST_SECRET);

  it('mints a verifiable token bound to (agentId, deviceId)', () => {
    expect(token.startsWith(`${KIOSK_TOKEN_PREFIX}.`)).toBe(true);
    const ok = verifyDeviceToken(token, TEST_SECRET, agentId);
    expect(ok.valid).toBe(true);
    expect(ok.agentId).toBe(agentId);
    expect(ok.deviceId).toBe(deviceId);
  });

  it('REJECTS a tampered signature', () => {
    expect(verifyDeviceToken(`${token}x`, TEST_SECRET, agentId).valid).toBe(false);
    const swapped = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(verifyDeviceToken(swapped, TEST_SECRET, agentId).valid).toBe(false);
  });

  it('REJECTS a token minted under a different secret (forgery)', () => {
    const forged = mintDeviceToken({ agentId, deviceId }, 'y'.repeat(48));
    expect(verifyDeviceToken(forged, TEST_SECRET, agentId).valid).toBe(false);
  });

  it('REJECTS a token bound to a DIFFERENT agent (cross-agent replay)', () => {
    expect(verifyDeviceToken(token, TEST_SECRET, 'some-other-agent').valid).toBe(false);
  });

  it('REJECTS when the secret is missing, and on malformed shapes (fail-closed)', () => {
    expect(verifyDeviceToken(token, undefined, agentId).valid).toBe(false);
    expect(verifyDeviceToken('', TEST_SECRET, agentId).valid).toBe(false);
    expect(verifyDeviceToken('not-a-token', TEST_SECRET, agentId).valid).toBe(false);
    expect(verifyDeviceToken('ksk-v1.only.three', TEST_SECRET, agentId).valid).toBe(false);
  });

  it('mint refuses to sign with no secret (fail-closed)', () => {
    expect(() => mintDeviceToken({ agentId, deviceId }, undefined)).toThrow(/VOICE_CONFIG_HMAC_SECRET/);
  });
});

describe('anonymous / model-blind — no identity reaches the assembled model payload', () => {
  it('the system prompt + messages the kiosk sends carry NONE of the synthetic identifiers', async () => {
    let captured: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const create: CreateMessage = vi.fn(async (params) => {
      captured = params;
      return fakeMessage(INFANT_FEVER_PROPOSAL);
    });

    // Even if a person spoke an identifier, it would be THEIR utterance — the kiosk attaches none.
    // Here we assert OUR assembled payload (system + the bridge-attached identity block).
    await runKioskSession(
      { agentId: 'demo', lang: 'en', utterance: 'my 2 month old has a fever of 101' },
      { createMessage: create, log: silentLog },
    );

    const payload = JSON.stringify({ system: captured?.system, messages: captured?.messages });
    for (const id of SYNTH_IDENTIFIERS) expect(payload).not.toContain(id);

    // The kiosk is anonymous: the identity passed to the loop is the UNVERIFIED block
    // (verified:false, empty opaqueRef) — so the system prompt states the caller is NOT verified
    // and instructs the model never to ask for identifiers. No opaque ref value leaks either.
    const sys = String(captured?.system).toLowerCase();
    expect(sys).toContain('never ask for');
    expect(sys).toContain('not identity-verified');
    expect(payload).not.toContain('idr_'); // unverified ⇒ empty opaqueRef, never an idr_ token
  });
});

describe('spoken disclaimer (no screen → spoken every session)', () => {
  it('is bilingual and spells 9 1 1 for the TTS, and never prescribes/diagnoses', () => {
    for (const lang of ['en', 'es'] as const) {
      const d = spokenDisclaimer(lang);
      expect(d).toMatch(/9 1 1/);
      const forbidden = ['dose', 'mg', 'prescrib', 'diagnos'];
      for (const f of forbidden) expect(d.toLowerCase()).not.toContain(f);
    }
  });
});
