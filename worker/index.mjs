// agent-worker — the Cara Spark standalone voice cascade (Lane G, T13/T10 · tk-0013).
//
// THE CASCADE:  Deepgram STT (nova-3 en / nova-2 es)  ->  Opus 4.8 brain (ANTHROPIC_API_KEY)
//               ->  Deepgram Aura TTS (aura-2-andromeda-en / aura-2-celeste-es).
//   EXPLICIT SIP dispatch: this worker registers under VOICE_AGENT_NAME and ONLY joins rooms a
//   dispatch rule names (room_config.agents=[name]); it additionally guards on VOICE_ROOM_PREFIX.
//
// THE SAFETY SPINE (model PROPOSES, engine DECIDES — runbook §3 / OSS law #2):
//   The worker NEVER picks a disposition. On EVERY caller turn — inside the agent's `llmNode`, the
//   one seam every turn passes through — it (1) has the Opus 4.8 brain propose TYPED evidence + a
//   risk estimate from what it heard, then (2) calls the app's /api/voice/decide endpoint, where the
//   DETERMINISTIC engine adjudicates and returns the action + verbatim bilingual guidance. The worker
//   speaks ONLY that guidance, non-interruptibly. The model can never soften a fired red flag, and a
//   terminal escalation latches the model out for the rest of the call.
//
//   NO PHI EVER reaches model context or the app payload: the brain sees only the spoken words it
//   transcribed (never a name/DOB injected by us), and /api/voice/decide receives typed evidence +
//   risk + the OPAQUE identity ref ({verified, opaqueRef}) — never a name/DOB/transcript.
//
// BILINGUAL EN/ES is core: the preamble + interview run in the call's language; the STT language and
// the Aura TTS voice are selected per call (deepgramSttConfig / auraTtsModel below).
//
// THE LLM BRAIN: there is NO Node @livekit/agents Anthropic plugin (only Python ships one), so the
// Opus 4.8 brain runs via the official @anthropic-ai/sdk, called from `llmNode`. This is deliberate:
// the brain only ever proposes evidence; the engine (in the app) owns every disposition.
//
// PORTABILITY: this file BOOTS even when the Agents SDK / plugins are not installed (e.g. a bare
// `docker compose up` of the OSS scaffold), running as a healthy idle worker. The real cascade runs
// when worker.Dockerfile has installed @livekit/agents + the deepgram/silero plugins + @anthropic-ai/sdk.
//
// ISOLATION: targets the STANDALONE LiveKit via LIVEKIT_URL/KEY/SECRET — NEVER the prod cara-realtime
// stack. No prod trunk/rule/agent/number is referenced anywhere in this file.

import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Config (env-driven; no secrets baked in).
// ---------------------------------------------------------------------------
const CFG = {
  livekitUrl: process.env.LIVEKIT_URL || 'ws://livekit:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY || '',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET || '',
  // The agent name this worker registers; the SIP dispatch rule must set
  // room_config.agents = [AGENT_NAME] (explicit dispatch). Standalone default (NOT cara-realtime).
  agentName: process.env.VOICE_AGENT_NAME || 'cara-spark-cascade',
  // Only handle rooms minted by our SIP dispatch rule (prefix match).
  roomPrefix: process.env.VOICE_ROOM_PREFIX || 'voicephone-',
  // The app base the worker calls for the no-PHI policy decision + post-call result.
  appBaseUrl: process.env.VOICE_APP_BASE_URL || process.env.AUTH_URL || 'http://app:3000',
  hmacSecret: process.env.VOICE_CONFIG_HMAC_SECRET || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  // Opus 4.8 — the cascade brain. Matches the app's TRIAGE_MODEL (lib/agent/extract.ts).
  anthropicModel: process.env.VOICE_LLM_MODEL || 'claude-opus-4-8',
  deepgramKey: process.env.DEEPGRAM_API_KEY || '',
};

const WORKER_TOKEN_PREFIX = 'cara-voicecfg-v1';

// ---------------------------------------------------------------------------
// Bilingual selection — STT language + Aura TTS voice per call language.
// Aura-2 model ids encode voice AND language: aura-2-<voice>-<lang>.
// (Mirrors lib/voice/guidance.ts so the worker speaks the caller's language.)
// ---------------------------------------------------------------------------
export function deepgramSttConfig(language) {
  return language === 'es'
    ? { model: process.env.VOICE_DEEPGRAM_MODEL || 'nova-2', language: 'es' }
    : { model: process.env.VOICE_DEEPGRAM_MODEL || 'nova-3', language: 'en-US' };
}
export function auraTtsModel(language) {
  return language === 'es'
    ? process.env.VOICE_AURA_MODEL_ES || 'aura-2-celeste-es'
    : process.env.VOICE_AURA_MODEL_EN || 'aura-2-andromeda-en';
}

// The mandatory spoken preamble (not-an-emergency disclaimer + recording notice), per language.
// Spoken VERBATIM and non-interruptibly at the top of every call (model cannot alter it).
export const PREAMBLE = {
  en: 'Hi, this is an automated care line. I am not a doctor and this is not medical advice. If this is an emergency, hang up and call 9 1 1. This call may be reviewed to keep you safe. How can I help today?',
  es: 'Hola, esta es una línea de atención automatizada. No soy médico y esto no es consejo médico. Si es una emergencia, cuelgue y llame al 9 1 1. Esta llamada puede ser revisada para su seguridad. ¿Cómo puedo ayudarle hoy?',
};

// A short fail-closed line in the call language (used only if /api/voice/decide is unreachable).
export function failClosedGuidance(language) {
  return language === 'es'
    ? 'Lo estoy conectando con una persona que puede ayudar. Por favor permanezca en la línea.'
    : "I'm connecting you to a person who can help. Please stay on the line.";
}

// ---------------------------------------------------------------------------
// Worker->app auth: mint a bearer token bound to the room/call id (byte-compatible with the app
// verifier — verifyWorkerToken in lib/voice/config-signature.ts).
// ---------------------------------------------------------------------------
export function mintWorkerToken(sessionId, secret) {
  if (!secret) throw new Error('VOICE_CONFIG_HMAC_SECRET not set — cannot authenticate to the app.');
  const nonce = randomBytes(16).toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(`${WORKER_TOKEN_PREFIX}:${sessionId}:${nonce}`, 'utf8')
    .digest('base64url');
  return `${WORKER_TOKEN_PREFIX}.${nonce}.${sig}`;
}

// ---------------------------------------------------------------------------
// The policy bridge — the ONLY place the worker gets a disposition. NO PHI in the payload:
// typed evidence + a risk estimate + the opaque identity ref. Returns { action, guidance, trace }.
// ---------------------------------------------------------------------------
export async function callDecide({ callId, agentId, language, identity, evidence, riskEstimate }) {
  const token = mintWorkerToken(callId, CFG.hmacSecret);
  const res = await fetch(`${CFG.appBaseUrl}/api/voice/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ callId, agentId, language, identity, evidence, riskEstimate }),
  });
  if (!res.ok) {
    // Fail CLOSED: if the engine/app is unreachable, the safest action is a human handoff.
    return {
      action: 'BLOCK_AND_HUMAN_HANDOFF',
      guidance: failClosedGuidance(language),
      trace: null,
      failClosed: true,
    };
  }
  return res.json();
}

export async function postCall(result) {
  const token = mintWorkerToken(result.callId, CFG.hmacSecret);
  const res = await fetch(`${CFG.appBaseUrl}/api/voice/post-call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(result),
  });
  return res.ok;
}

// Actions that LATCH the model out of the call once decided (matches lib/voice/guidance.ts).
export function isTerminal(action) {
  return (
    action === 'ED_OR_911_GUIDANCE' ||
    action === 'IMMEDIATE_CLINIC_CALLBACK' ||
    action === 'BLOCK_AND_HUMAN_HANDOFF'
  );
}

function safeJson(s) {
  try {
    return JSON.parse(s) || {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Evidence proposal — the Opus 4.8 brain reads the caller's latest utterance(s) and emits TYPED
// evidence (EvidenceFact[]) + a RiskEstimate. The model PROPOSES; it never decides.
//
// PHI DISCIPLINE: the brain only ever sees the words the caller spoke (transcribed by Deepgram). We
// never inject a name/DOB into its context, and we never forward a raw transcript to the app — only
// the typed facts + risk below. Identity stays the opaque ref ({verified, opaqueRef}) end-to-end.
//
// We ask Opus 4.8 for STRICT JSON (structured outputs) so the result is parseable and bounded. If
// the brain is unavailable or returns malformed output, we return a low-confidence, high-OOD estimate
// with NO evidence — which the deterministic engine will (correctly) route to a cautious disposition.
// ---------------------------------------------------------------------------
const EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          factType: { type: 'string' }, // e.g. symptom | severity | duration | chief_complaint
          value: { type: 'string' }, // the clinical value the caller stated, in plain words
          confidence: { type: 'number' },
        },
        required: ['factType', 'value', 'confidence'],
      },
    },
    riskEstimate: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pRoutine: { type: 'number' },
        pUrgent: { type: 'number' },
        pCritical: { type: 'number' },
        confidence: { type: 'number' },
        oodScore: { type: 'number' },
        evidenceCoverageScore: { type: 'number' },
        reasonCodes: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'pRoutine',
        'pUrgent',
        'pCritical',
        'confidence',
        'oodScore',
        'evidenceCoverageScore',
        'reasonCodes',
      ],
    },
  },
  required: ['evidence', 'riskEstimate'],
};

const EVIDENCE_SYSTEM_PROMPT = [
  'You are the evidence-extraction stage of a deterministic medical-triage agent.',
  'You do NOT decide any disposition — a separate deterministic engine does that. Your ONLY job is',
  'to read what the caller said and propose: (1) a list of typed clinical evidence facts, and (2) a',
  'calibrated risk estimate (probabilities of routine/urgent/critical, plus confidence, an',
  'out-of-distribution score, and an evidence-coverage score).',
  'Never output a recommendation, reassurance, or instruction. Never invent facts the caller did not',
  'state. If the caller gave little to go on, return few/no facts and a LOW evidence-coverage score',
  'and a HIGH out-of-distribution score. Output must match the provided JSON schema exactly.',
].join(' ');

/**
 * Build the typed decision payload for one caller turn. `transcript` is the caller's spoken words
 * (already PHI-minimized by being just what they chose to say). `anthropic` is the @anthropic-ai/sdk
 * client; `language` is the call language. NO PHI is added here and none leaves in the return value
 * beyond typed facts + risk.
 */
export async function proposeEvidence({ anthropic, transcript, language, traceId }) {
  const now = new Date().toISOString();
  const fallback = {
    evidence: [],
    riskEstimate: {
      pRoutine: 0.34,
      pUrgent: 0.33,
      pCritical: 0.33,
      confidence: 0.2,
      oodScore: 0.8,
      evidenceCoverageScore: 0.1,
      reasonCodes: ['brain_unavailable_or_unparsed'],
      modelVersion: CFG.anthropicModel,
    },
    identity: { verified: false, opaqueRef: '' },
  };

  if (!anthropic || !transcript) return fallback;

  let parsed;
  try {
    // Opus 4.8 via the Anthropic SDK. Adaptive thinking + structured JSON output; streaming is not
    // needed (the output is small and bounded). No PHI in the prompt beyond the caller's own words.
    const msg = await anthropic.messages.create({
      model: CFG.anthropicModel,
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: EVIDENCE_SCHEMA } },
      system: EVIDENCE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Call language: ${language}. The caller said:\n"""${transcript}"""\n` +
            'Extract typed evidence facts and a risk estimate per the schema.',
        },
      ],
    });
    // Concatenate text blocks (structured-output JSON is returned as text content).
    const text = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    parsed = JSON.parse(text);
  } catch {
    return fallback;
  }

  // Map the brain's lightweight proposal onto the frozen EvidenceFact[] shape the engine expects
  // (engine/types.ts). Source is `voice_transcript` (low trust) — the engine weighs trust itself.
  const evidence = Array.isArray(parsed?.evidence)
    ? parsed.evidence.map((e, i) => ({
        id: `${traceId}-ev-${i}`,
        factType: String(e.factType || 'chief_complaint'),
        value: e.value,
        confidence: clamp01(e.confidence),
        source: 'voice_transcript',
        sourceTrust: 'low',
        verified: false,
        createdAt: now,
        modelVersion: CFG.anthropicModel,
        traceId,
      }))
    : [];

  const r = parsed?.riskEstimate || {};
  const riskEstimate = {
    pRoutine: clamp01(r.pRoutine, 0.34),
    pUrgent: clamp01(r.pUrgent, 0.33),
    pCritical: clamp01(r.pCritical, 0.33),
    confidence: clamp01(r.confidence, 0.2),
    oodScore: clamp01(r.oodScore, 0.5),
    evidenceCoverageScore: clamp01(r.evidenceCoverageScore, 0.2),
    reasonCodes: Array.isArray(r.reasonCodes) ? r.reasonCodes.map(String) : [],
    modelVersion: CFG.anthropicModel,
  };

  // Identity is resolved out-of-band (browser OTP / DTMF) and is the opaque ref ONLY — never raw PHI.
  // The worker never derives identity from the transcript.
  return { evidence, riskEstimate, identity: { verified: false, opaqueRef: '' } };
}

function clamp01(n, fallback = 0) {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, x));
}

/**
 * Pull the caller's most recent spoken text out of a LiveKit ChatContext. This is the ONLY thing the
 * brain ever sees — the words the caller chose to say. We never add a name/DOB to model context.
 *
 * TODO(livekit-api): confirm the exact ChatContext accessor in this version. v1.x overhauled
 * ChatContext; the items are commonly on `chatCtx.items` with `role` and a `content`/`textContent`.
 * We defensively read the last user item's text and fall back to '' so a shape change degrades to
 * "no transcript" (a cautious engine disposition) rather than throwing.
 */
export function latestUserText(chatCtx) {
  try {
    const items = chatCtx?.items || chatCtx?.messages || [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it?.role && it.role !== 'user') continue;
      const text =
        (typeof it?.textContent === 'string' && it.textContent) ||
        (typeof it?.content === 'string' && it.content) ||
        (Array.isArray(it?.content)
          ? it.content
              .map((c) => (typeof c === 'string' ? c : c?.text || ''))
              .join(' ')
              .trim()
          : '');
      if (text) return text;
    }
  } catch {
    /* fall through to '' */
  }
  return '';
}

// ---------------------------------------------------------------------------
// LiveKit agent wiring — only when the Agents SDK + plugins are installed (worker.Dockerfile).
//
// We define ONE agent (default export below) and register it under VOICE_AGENT_NAME so explicit
// dispatch (room_config.agents=[name]) routes calls here. The custom `CascadeAgent.llmNode` is where
// the engine gate lives: every caller turn is adjudicated by the app before the worker speaks.
// ---------------------------------------------------------------------------

/**
 * Lazily import the LiveKit Agents SDK + plugins + the Anthropic SDK. Returns null if anything is
 * missing (the OSS scaffold ships without them) so `main()` can fall back to a healthy idle boot.
 */
async function loadSdks() {
  try {
    const agents = await import('@livekit/agents');
    const deepgram = await import('@livekit/agents-plugin-deepgram');
    const silero = await import('@livekit/agents-plugin-silero').catch(() => null);
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    return { agents, deepgram, silero, Anthropic };
  } catch {
    return null;
  }
}

/**
 * Build the agent module (default export shape for `defineAgent`). Kept as a factory so it can be
 * constructed from the loaded SDKs and unit-reasoned about without import side effects.
 */
function buildAgent(sdks) {
  const { agents, deepgram, silero, Anthropic } = sdks;
  const { defineAgent, voice } = agents;

  const anthropic = CFG.anthropicKey ? new Anthropic({ apiKey: CFG.anthropicKey }) : null;

  // The cascade agent. We subclass voice.Agent to override `llmNode` — the single seam every caller
  // turn passes through — so the DETERMINISTIC ENGINE (not the model) produces every spoken line.
  class CascadeAgent extends voice.Agent {
    constructor({ language, agentId, callId }) {
      // `instructions` shape the brain's behavior, but the engine still owns dispositions. We keep
      // them minimal and non-clinical here; the real reasoning prompt lives in proposeEvidence().
      super({
        instructions:
          'You are a triage intake assistant. You gather what the caller is experiencing. You never ' +
          'diagnose, reassure, or advise — a separate safety system decides what to tell the caller.',
      });
      this.language = language;
      this.agentId = agentId;
      this.callId = callId;
      this.latched = false; // set true after a terminal escalation — the model stays out
      // Latest engine decision, for the no-PHI post-call result. Defaults to the safe handoff.
      this.lastAction = 'BLOCK_AND_HUMAN_HANDOFF';
      this.lastTrace = null;
    }

    /**
     * Engine-gated turn. Verified signature (LiveKit Agents v1.x, Node):
     *   async llmNode(chatCtx, toolCtx, modelSettings): Promise<ReadableStream<ChatChunk|string>|null>
     * We do NOT call the default LLM node. Instead, on each turn we:
     *   1. take the caller's latest spoken text from chatCtx (NO PHI is added by us),
     *   2. have Opus 4.8 PROPOSE typed evidence + risk (proposeEvidence),
     *   3. call /api/voice/decide so the DETERMINISTIC ENGINE picks the action + verbatim guidance,
     *   4. stream back ONLY that guidance text — the model never authors the spoken line.
     */
    async llmNode(chatCtx, _toolCtx, _modelSettings) {
      // Once a terminal escalation has fired, the model is latched out: keep repeating the safe line.
      const transcript = this.latched ? '' : latestUserText(chatCtx);
      const traceId = `${this.callId}-${Date.now()}`;

      const { evidence, riskEstimate, identity } = await proposeEvidence({
        anthropic,
        transcript,
        language: this.language,
        traceId,
      });

      const decision = await callDecide({
        callId: this.callId,
        agentId: this.agentId,
        language: this.language,
        identity,
        evidence,
        riskEstimate,
      });

      if (isTerminal(decision.action)) this.latched = true;
      // Record for the post-call result (read by the room-close handler). No PHI: action + trace only.
      this.lastAction = decision.action;
      this.lastTrace = decision.trace ?? null;

      // Stream a single chunk of the engine-authored guidance. The session speaks it via TTS.
      // TODO(livekit-api): confirm the exact ChatChunk shape this version expects. A plain string
      // chunk is accepted per the documented `ReadableStream<ChatChunk | string>` return type; if a
      // future version requires a structured delta, wrap `guidance` accordingly (do NOT let the model
      // author the text — always emit `decision.guidance` verbatim).
      const guidance = decision.guidance || failClosedGuidance(this.language);
      return new ReadableStream({
        start(controller) {
          controller.enqueue(guidance);
          controller.close();
        },
      });
    }
  }

  return defineAgent({
    // Pre-load the VAD model once per worker process (faster session starts).
    prewarm: async (proc) => {
      if (silero) {
        try {
          proc.userData.vad = await silero.VAD.load();
        } catch {
          /* VAD optional — turn detection still works without it on most setups */
        }
      }
    },

    entry: async (ctx) => {
      // EXPLICIT dispatch already routed this room to us by name. Additionally guard on the room-name
      // prefix so a stray room can never be answered by this worker.
      const roomName = ctx.room?.name || '';
      if (!roomName.startsWith(CFG.roomPrefix)) return;

      // The call language + the opaque agent ref ride on the dispatch attributes / room metadata
      // (no PHI). Default to English when unset.
      const attrs = ctx.room?.metadata ? safeJson(ctx.room.metadata) : {};
      const language = attrs.language === 'es' ? 'es' : 'en';
      const agentId = attrs.agentId || CFG.agentName;
      const callId = roomName;
      const startedAt = new Date().toISOString();

      const stt = new deepgram.STT(deepgramSttConfig(language));
      // Aura-2 TTS. Aura model ids encode the voice + language. TODO(livekit-api): confirm whether
      // the deepgram TTS option key for the Aura model is `model` in this plugin version (it is in
      // the documented examples); if it differs, map auraTtsModel(language) onto the correct field.
      const tts = new deepgram.TTS({ model: auraTtsModel(language) });
      const vad = ctx.proc?.userData?.vad;

      const agent = new CascadeAgent({ language, agentId, callId });

      // The session wires the cascade. The LLM is engine-gated entirely via CascadeAgent.llmNode, so
      // we intentionally do not pass a model `llm` here — llmNode supplies every turn's output.
      const session = new voice.AgentSession({ stt, tts, vad });

      // Speak the mandatory not-an-emergency preamble VERBATIM, non-interruptibly (verified API).
      await session.say(PREAMBLE[language], { allowInterruptions: false });

      // Best-effort: when the room ends, drop a post-call result into the review queue + audit trail
      // (T11). NO transcript PHI — only the final deterministic disposition + provable trace, read off
      // the agent (CascadeAgent.llmNode records the latest engine decision there each turn).
      const onClose = async () => {
        try {
          await postCall({
            callId,
            agentId,
            language,
            startedAt,
            endedAt: new Date().toISOString(),
            disposition: agent.lastAction,
            trace: agent.lastTrace,
          });
        } catch {
          /* post-call is best-effort; the live call is already complete */
        }
      };
      // TODO(livekit-api): confirm the room/session close event name in this version (candidates:
      // 'disconnected' on ctx.room, or a 'close' on the session). The engine gate in llmNode is the
      // source of truth regardless — this listener only flushes the post-call summary.
      try {
        ctx.room?.on?.('disconnected', onClose);
      } catch {
        /* optional */
      }

      await session.start({ agent, room: ctx.room });
    },
  });
}

// ---------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------
// Load the SDKs + build the agent ONCE at module scope. `_SDKS` is null on the OSS scaffold (the
// Agents SDK / plugins are not installed) and the default export is undefined — `main()` then falls
// back to a healthy idle boot. We use a top-level await import (this module is ESM, `type: module`).
//
// LiveKit's `cli.runApp` re-imports this module in a worker subprocess and uses the DEFAULT export as
// the agent — so the default export must BE the `defineAgent(...)` result. Building it here (not
// inside main) means both the parent and the worker subprocess get the same agent definition.
const _SDKS = await loadSdks();
const _AGENT = _SDKS ? buildAgent(_SDKS) : undefined;
export default _AGENT;

async function main() {
  console.log(
    `[agent-worker] cara-spark voice cascade — agent_name=${CFG.agentName} prefix=${CFG.roomPrefix} ` +
      `livekit=${CFG.livekitUrl} app=${CFG.appBaseUrl} model=${CFG.anthropicModel}`,
  );

  if (!_SDKS) {
    console.log(
      '[agent-worker] LiveKit Agents SDK / plugins not installed — running as a healthy idle worker. ' +
        'Build worker.Dockerfile (installs @livekit/agents + deepgram/silero plugins + @anthropic-ai/sdk) ' +
        'to run the live cascade.',
    );
    setInterval(() => {}, 1 << 30);
    return;
  }

  const { cli, WorkerOptions } = _SDKS.agents;

  // Register the worker under VOICE_AGENT_NAME so EXPLICIT dispatch (room_config.agents=[name]) routes
  // calls here, and ONLY here (a non-empty agentName disables automatic dispatch). cli.runApp owns
  // the worker lifecycle + the LiveKit connection; the agent entry is the DEFAULT export of this
  // module path.
  cli.runApp(
    new WorkerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: CFG.agentName,
      wsURL: CFG.livekitUrl,
      apiKey: CFG.livekitApiKey,
      apiSecret: CFG.livekitApiSecret,
    }),
  );
}

// Only auto-run as the entrypoint (so tests can import the pure helpers without booting the worker).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[agent-worker] fatal', err);
    process.exit(1);
  });
}
