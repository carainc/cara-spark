/**
 * Standalone voice WORKER — pure-helper contract tests (tk-0013).
 *
 * The worker (worker/index.mjs) is a real @livekit/agents worker; its live cascade needs a LiveKit
 * stack, so it is NOT exercised end-to-end here. But its SAFETY-CRITICAL helpers are pure and
 * deterministic, and they encode the model-proposes / engine-decides split and the no-PHI rule —
 * so they get locked with unit tests:
 *
 *   • callDecide       — FAILS CLOSED to BLOCK_AND_HUMAN_HANDOFF when /api/voice/decide is
 *                        unreachable, and forwards the engine's verdict VERBATIM on success while
 *                        sending NO PHI (identity is the opaque ref only).
 *   • proposeEvidence  — with no brain, degrades to a cautious (low-confidence / high-OOD) estimate
 *                        with NO evidence and an empty opaque ref. Never echoes a name/DOB.
 *   • deepgramSttConfig / auraTtsModel — bilingual EN/ES selection (OSS law #5).
 *   • isTerminal       — exactly the latch-out escalation set (matches lib/voice/guidance.ts).
 *   • latestUserText   — pulls the caller's last spoken turn out of a ChatContext.
 *
 * The worker is .mjs (excluded from tsc), so we import it directly; on the test host the LiveKit SDK
 * is absent, so the module's default agent export is undefined and only the pure helpers load.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// The worker's CFG snapshots process.env at MODULE-LOAD time, so set the HMAC secret BEFORE importing
// it, then load it via a top-level dynamic import (ESM top-level await). This binds CFG.hmacSecret so
// the worker->app bearer token can be minted in the callDecide tests.
const HMAC = 'test-secret-min-32-chars-aaaaaaaaaaaa';
process.env.VOICE_CONFIG_HMAC_SECRET = HMAC;

const worker = await import('../worker/index.mjs');
const {
  callDecide,
  proposeEvidence,
  deepgramSttConfig,
  auraTtsModel,
  isTerminal,
  latestUserText,
  resolveRoomName,
  failClosedGuidance,
  ensureStartSubcommand,
} = worker as {
  callDecide: (a: unknown) => Promise<{ action: string; guidance: string; failClosed?: boolean }>;
  proposeEvidence: (a: unknown) => Promise<{
    evidence: unknown[];
    riskEstimate: { confidence: number; oodScore: number; evidenceCoverageScore: number };
    identity: { verified: boolean; opaqueRef: string };
  }>;
  deepgramSttConfig: (l: string) => { model: string; language: string };
  auraTtsModel: (l: string) => string;
  isTerminal: (a: string) => boolean;
  latestUserText: (ctx: unknown) => string;
  resolveRoomName: (ctx: unknown) => string;
  failClosedGuidance: (l: string) => string;
  ensureStartSubcommand: (argv: string[]) => string[];
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('worker callDecide — fail closed + engine decides + no PHI', () => {
  it('fails CLOSED to BLOCK_AND_HUMAN_HANDOFF when the policy endpoint is unreachable', async () => {
    // fetch rejects (engine/app down) → the worker must NOT proceed; safest action is a handoff.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );

    const decision = await callDecide({
      callId: 'voicephone-agent-1-room',
      agentId: 'agent-1',
      language: 'en',
      identity: { verified: false, opaqueRef: '' },
      evidence: [],
      riskEstimate: {},
    });

    expect(decision.action).toBe('BLOCK_AND_HUMAN_HANDOFF');
    expect(decision.failClosed).toBe(true);
    expect(decision.guidance).toBe(failClosedGuidance('en'));
  });

  it('forwards the deterministic engine verdict VERBATIM on success', async () => {
    const engineVerdict = {
      action: 'SAME_DAY_REVIEW',
      guidance: 'This should be looked at today.',
      trace: { traceId: 't-1' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => engineVerdict })),
    );

    const decision = await callDecide({
      callId: 'voicephone-agent-1-room',
      agentId: 'agent-1',
      language: 'en',
      identity: { verified: true, opaqueRef: 'opaque-123' },
      evidence: [],
      riskEstimate: {},
    });

    // The worker never softens or overrides the engine — it passes the verdict straight through.
    expect(decision).toEqual(engineVerdict);
  });

  it('sends NO PHI to /api/voice/decide — only opaque identity + typed evidence + risk', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ action: 'ROUTINE_REVIEW', guidance: 'x', trace: {} }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await callDecide({
      callId: 'voicephone-agent-1-room',
      agentId: 'agent-1',
      language: 'es',
      identity: { verified: true, opaqueRef: 'opaque-abc' },
      evidence: [{ factType: 'symptom', value: 'cough', confidence: 0.8 }],
      riskEstimate: { pRoutine: 0.7 },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: { authorization: string }; body: string },
    ];
    expect(String(url)).toMatch(/\/api\/voice\/decide$/);
    // Bearer token bound to the call id (HMAC scheme) — never a raw secret.
    expect(init.headers.authorization).toMatch(/^Bearer cara-voicecfg-v1\./);

    const body = JSON.parse(init.body);
    // Identity is the opaque ref ONLY — no name/DOB/phone fields exist on the payload.
    expect(body.identity).toEqual({ verified: true, opaqueRef: 'opaque-abc' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/fullName|dateOfBirth|"dob"|"phone"|"email"|"mrn"/i);
  });
});

describe('worker proposeEvidence — no brain → cautious, no PHI', () => {
  it('returns no evidence + a low-confidence / high-OOD estimate when the brain is absent', async () => {
    const { evidence, riskEstimate, identity } = await proposeEvidence({
      anthropic: null,
      transcript: 'I have had a headache for two days',
      language: 'en',
      traceId: 't-1',
    });

    expect(evidence).toEqual([]);
    expect(riskEstimate.confidence).toBeLessThanOrEqual(0.3);
    expect(riskEstimate.oodScore).toBeGreaterThanOrEqual(0.7);
    expect(riskEstimate.evidenceCoverageScore).toBeLessThanOrEqual(0.2);
    // Identity stays the opaque ref — the worker never derives identity from the transcript.
    expect(identity).toEqual({ verified: false, opaqueRef: '' });
  });

  it('does not echo the transcript or any identifier into the proposal', async () => {
    // Synthetic, non-PHI-shaped sentinels: the test only needs strings the proposal must NOT contain.
    const nameSentinel = 'SENTINEL_NAME_TOKEN';
    const idSentinel = 'SENTINEL_ID_TOKEN';
    const result = await proposeEvidence({
      anthropic: null,
      transcript: `My name is ${nameSentinel}, my id is ${idSentinel}, my chest hurts`,
      language: 'en',
      traceId: 't-2',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(nameSentinel);
    expect(serialized).not.toContain(idSentinel);
  });
});

describe('worker bilingual STT/TTS selection (mirrors lib/voice/guidance.ts)', () => {
  it('selects Spanish STT + a Spanish Aura voice for es', () => {
    expect(deepgramSttConfig('es').language).toBe('es');
    expect(auraTtsModel('es')).toMatch(/-es$/);
  });
  it('selects English STT + an English Aura voice for en', () => {
    expect(deepgramSttConfig('en').language).toBe('en-US');
    expect(auraTtsModel('en')).toMatch(/-en$/);
  });
  it('en and es resolve to DIFFERENT Aura voices', () => {
    expect(auraTtsModel('en')).not.toBe(auraTtsModel('es'));
  });
});

describe('worker isTerminal — the latch-out escalation set', () => {
  it('latches on emergency / immediate-callback / human-handoff, not on routine actions', () => {
    expect(isTerminal('ED_OR_911_GUIDANCE')).toBe(true);
    expect(isTerminal('IMMEDIATE_CLINIC_CALLBACK')).toBe(true);
    expect(isTerminal('BLOCK_AND_HUMAN_HANDOFF')).toBe(true);
    expect(isTerminal('SELF_CARE_INFO_ONLY')).toBe(false);
    expect(isTerminal('ROUTINE_REVIEW')).toBe(false);
    expect(isTerminal('SAME_DAY_REVIEW')).toBe(false);
  });
});

describe('worker latestUserText — extract the caller turn from a ChatContext', () => {
  it('returns the most recent user turn (string content)', () => {
    expect(
      latestUserText({
        items: [
          { role: 'assistant', content: 'How can I help?' },
          { role: 'user', content: 'my chest hurts' },
        ],
      }),
    ).toBe('my chest hurts');
  });
  it('handles array content blocks and ignores assistant turns', () => {
    expect(
      latestUserText({
        items: [
          { role: 'user', content: [{ text: 'first' }] },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: [{ text: 'I feel' }, { text: 'dizzy' }] },
        ],
      }),
    ).toBe('I feel dizzy');
  });
  it('degrades to empty string on an unexpected shape (cautious, no throw)', () => {
    expect(latestUserText(undefined)).toBe('');
    expect(latestUserText({})).toBe('');
  });
});

describe('worker ensureStartSubcommand — the worker actually boots in production', () => {
  // Regression for the crash-loop: @livekit/agents cli.runApp() prints --help and exits when no
  // subcommand is in argv. The worker must default to `start` so `node worker/index.mjs` boots.
  it('inserts `start` when no subcommand is present (bare `node worker/index.mjs`)', () => {
    expect(ensureStartSubcommand(['node', '/app/worker/index.mjs'])).toEqual([
      'node',
      '/app/worker/index.mjs',
      'start',
    ]);
  });

  it('preserves an explicit subcommand and its flags', () => {
    for (const sub of ['start', 'dev', 'connect', 'download-files']) {
      expect(ensureStartSubcommand(['node', 'index.mjs', sub])).toEqual(['node', 'index.mjs', sub]);
    }
    // flags after an explicit subcommand are untouched
    expect(ensureStartSubcommand(['node', 'index.mjs', 'dev', '--log-level', 'debug'])).toEqual([
      'node',
      'index.mjs',
      'dev',
      '--log-level',
      'debug',
    ]);
  });

  it('inserts `start` before stray args when argv[2] is not a known subcommand', () => {
    expect(ensureStartSubcommand(['node', 'index.mjs', '--log-level', 'info'])).toEqual([
      'node',
      'index.mjs',
      'start',
      '--log-level',
      'info',
    ]);
  });

  it('does not mutate the input argv (pure)', () => {
    const argv = ['node', 'index.mjs'];
    ensureStartSubcommand(argv);
    expect(argv).toEqual(['node', 'index.mjs']);
  });
});

describe('worker resolveRoomName — the 667 "rings but no pickup" regression', () => {
  // @livekit/agents v1.4.6: ctx.room is UNDEFINED until ctx.connect(); the assigned room name rides on
  // ctx.job.room.name. The entrypoint reads the name BEFORE connect (to prefix-guard), so reading
  // ctx.room.name alone returned '' → the guard bailed → the agent never joined → the SIP caller was
  // stuck ringing until DTLS timeout. resolveRoomName must read job.room.name pre-connect.
  it('reads ctx.job.room.name when ctx.room is undefined (v1.4.6 pre-connect — the bug)', () => {
    expect(
      resolveRoomName({ job: { room: { name: 'voicephone-agent-1-abc' } }, room: undefined }),
    ).toBe('voicephone-agent-1-abc');
  });

  it('falls back to ctx.room.name for SDK versions that populate it early', () => {
    expect(resolveRoomName({ job: undefined, room: { name: 'voicephone-x' } })).toBe('voicephone-x');
  });

  it('prefers job.room.name over a stale ctx.room.name', () => {
    expect(
      resolveRoomName({ job: { room: { name: 'voicephone-correct' } }, room: { name: 'stale' } }),
    ).toBe('voicephone-correct');
  });

  it('degrades to empty string on an unexpected shape (cautious, no throw)', () => {
    expect(resolveRoomName(undefined)).toBe('');
    expect(resolveRoomName({})).toBe('');
    expect(resolveRoomName({ job: {} })).toBe('');
  });
});
