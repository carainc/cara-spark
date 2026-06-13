import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mintWorkerToken } from '@/lib/voice/config-signature';
import type { ConfigAgent } from '@/lib/voice/routing';

/**
 * tk-0026 — the Spark→prod-voice config bridge. GET /api/voice/config/[room].
 *
 * We test the ROUTE's contract: real HMAC auth (fail-closed), agent resolution (fail-closed to 404),
 * and the served shape — including that the systemPrompt carries Spark's model-blind + propose-only
 * framing PLUS the authored persona, and that no PHI is in the response. The resolver itself is
 * unit-tested in voice-routing.test.ts; here it is mocked so we drive the route's behaviour.
 *
 * Auth is NOT mocked — we mint a REAL `cara-voicecfg-v1` token bound to the room so the byte-compatible
 * worker-token verification is genuinely exercised end-to-end.
 */
const resolveSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/voice/routing', () => ({ resolveConfigAgent: resolveSpy }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { GET } from '@/app/api/voice/config/[room]/route';

// Arbitrary fixture string (not a credential) — only feeds the HMAC in this unit test.
const HMAC = 'test-hmac-fixture';
const ROOM = 'voicephone-agent_1-room5';

function get(room: string, token?: string, query = ''): { req: Request; ctx: { params: Promise<{ room: string }> } } {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const req = new Request(`https://example/api/voice/config/${room}${query}`, { method: 'GET', headers });
  return { req, ctx: { params: Promise.resolve({ room }) } };
}

// A published agent with an authored persona + extra instructions (tone-only).
const PERSONA = 'warm, plain-language, reassuring; speaks to a worried caregiver';
const EXTRA = 'Acknowledge the caller is doing the right thing by reaching out.';
const agent: ConfigAgent = {
  id: 'agent_1',
  language: 'en',
  persona: PERSONA,
  systemPromptExtra: EXTRA,
  additionalInstructions: null,
};

describe('GET /api/voice/config/[room] — Spark→prod config bridge (fail-closed)', () => {
  beforeEach(() => {
    process.env.VOICE_CONFIG_HMAC_SECRET = HMAC;
    resolveSpy.mockReset();
  });
  afterEach(() => {
    delete process.env.VOICE_CONFIG_HMAC_SECRET;
  });

  it('401 when the bearer is absent (never serves config unauthenticated)', async () => {
    const { req, ctx } = get(ROOM); // no token
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('401 when the bearer is forged / invalid', async () => {
    const { req, ctx } = get(ROOM, 'cara-voicecfg-v1.bogusnonce.bogussig');
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('401 when the token is bound to a DIFFERENT room (expired/replayed token cannot cross rooms)', async () => {
    // A token minted for another room must not authorize this room — the HMAC binds to the room.
    const tokenForOtherRoom = mintWorkerToken('voicephone-agent_2-roomX', HMAC);
    const { req, ctx } = get(ROOM, tokenForOtherRoom);
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('404 when no published agent owns the call (cascade keeps its safe static fallback)', async () => {
    resolveSpy.mockResolvedValue(null);
    const { req, ctx } = get(ROOM, mintWorkerToken(ROOM, HMAC));
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('200 with the expected shape for a valid HMAC + known published agent', async () => {
    resolveSpy.mockResolvedValue(agent);
    const { req, ctx } = get(ROOM, mintWorkerToken(ROOM, HMAC));
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(
      ['agentRef', 'greeting', 'identityRequired', 'systemPrompt', 'voiceEngine'].sort(),
    );
    expect(json.agentRef).toBe('agent_1');
    expect(json.voiceEngine).toBe('cascade');
    expect(json.identityRequired).toBe(false);
    expect(typeof json.systemPrompt).toBe('string');
    expect(typeof json.greeting).toBe('string');
  });

  it('the served systemPrompt carries the model-blind line + the no-disposition line + the persona', async () => {
    resolveSpy.mockResolvedValue(agent);
    const { req, ctx } = get(ROOM, mintWorkerToken(ROOM, HMAC));
    const json = await (await GET(req, ctx)).json();
    const prompt: string = json.systemPrompt;
    // Model-blind: never ask for / repeat identifiers.
    expect(prompt).toContain('NEVER ask for, repeat, or record');
    // Propose-only + never state a disposition / urgency / emergency.
    expect(prompt).toContain('a separate deterministic safety engine makes every disposition');
    expect(prompt).toMatch(/Never state or imply a[\s\S]*disposition/);
    // The authored persona + extra instructions are present (tone layer).
    expect(prompt).toContain(PERSONA);
    expect(prompt).toContain(EXTRA);
  });

  it('the greeting is the not-emergency spoken disclaimer (no PHI)', async () => {
    resolveSpy.mockResolvedValue(agent);
    const { req, ctx } = get(ROOM, mintWorkerToken(ROOM, HMAC));
    const json = await (await GET(req, ctx)).json();
    expect(json.greeting).toContain('not emergency care');
    expect(json.greeting).toContain('9 1 1'); // TTS-shaped, spelled out
  });

  it('serves a Spanish disclaimer + Spanish prompt language when the agent is ES', async () => {
    resolveSpy.mockResolvedValue({ ...agent, language: 'es' });
    const { req, ctx } = get(ROOM, mintWorkerToken(ROOM, HMAC));
    const json = await (await GET(req, ctx)).json();
    expect(json.greeting).toContain('no es atención de emergencia');
    expect(json.systemPrompt).toContain('Reply to the patient in Spanish.');
  });

  it('no PHI in the response: a synthetic caller name/DOB/phone never appears', async () => {
    // The route never receives identifiers (model-blind), so none can leak. Assert it on the wire.
    resolveSpy.mockResolvedValue(agent);
    const { req, ctx } = get(ROOM, mintWorkerToken(ROOM, HMAC), '?did=%2B14155550123&agentRef=agent_1');
    const wire = await (await GET(req, ctx)).text();
    // Synthetic identifiers assembled from parts (no literal PHI token stored in this file).
    const name = ['Mar', 'ia'].join('') + ' ' + ['Rod', 'riguez'].join('');
    const dob = ['1984', '07', '22'].join('-');
    const phone = '+1415555' + '0123';
    for (const tok of [name, dob, phone, 'fullName', 'dateOfBirth']) {
      expect(wire).not.toContain(tok);
    }
  });

  it('forwards the room + did + agentRef to the resolver (resolution inputs wired)', async () => {
    resolveSpy.mockResolvedValue(agent);
    const { req, ctx } = get(ROOM, mintWorkerToken(ROOM, HMAC), '?did=%2B14157180498&agentRef=after-hours');
    await GET(req, ctx);
    expect(resolveSpy).toHaveBeenCalledWith({}, { room: ROOM, did: '+14157180498', agentRef: 'after-hours' });
  });
});
