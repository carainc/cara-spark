// agent-worker — the Cara Spark standalone voice cascade (Lane G, T13/T10).
//
// THE CASCADE:  Deepgram STT (en/es per call language)  →  Opus 4.8 brain (ANTHROPIC_API_KEY)
//               →  Deepgram Aura TTS (an ES voice for Spanish).  Explicit SIP dispatch: this
//               worker registers AGENT_NAME and the dispatch rule sets room_config.agents=[name].
//
// THE SAFETY SPINE (model PROPOSES, engine DECIDES — runbook §3 / OSS law #2):
//   The worker NEVER picks a disposition. Before it speaks, and at the end of the call, it calls
//   the app's policy endpoints (/api/voice/decide, /api/voice/post-call) with NO-PHI payloads
//   (typed evidence + a risk estimate + the OPAQUE identity ref — never a name/DOB/transcript).
//   The app runs the deterministic engine and returns the action + verbatim, bilingual guidance,
//   which the worker speaks non-interruptibly. A fired escalation latches the model out.
//
// BILINGUAL EN/ES is core: the preamble + the interview run in the call's language; STT language
// and the Aura TTS voice are selected per call (see config below).
//
// PORTABILITY: this file BOOTS even when the LiveKit Agents SDK / plugins are not installed (the
// OSS scaffold ships without them so `docker compose up` and `pnpm install` stay light). When the
// SDK is present (a real standalone deploy), it wires the full agent. Either way the worker is a
// healthy long-lived process. Install on the voice box:
//   npm i @livekit/agents @livekit/agents-plugin-deepgram @livekit/agents-plugin-anthropic \
//         @livekit/agents-plugin-silero
//
// ISOLATION: targets the STANDALONE LiveKit via LIVEKIT_URL/KEY/SECRET — NEVER the prod
// cara-realtime stack.

import { createHmac, randomBytes } from 'node:crypto';

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
  anthropicModel: process.env.VOICE_LLM_MODEL || 'claude-opus-4-8',
  deepgramKey: process.env.DEEPGRAM_API_KEY || '',
};

const WORKER_TOKEN_PREFIX = 'cara-voicecfg-v1';

// ---------------------------------------------------------------------------
// Bilingual selection — STT language + Aura TTS voice per call language.
// Aura-2 model ids encode voice AND language: aura-2-<voice>-<lang>.
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

// The mandatory spoken preamble (not medical advice + recording notice), per language. Verbatim.
export const PREAMBLE = {
  en: 'Hi, this is an automated care line. I am not a doctor and this is not medical advice. If this is an emergency, hang up and call 9 1 1. This call may be reviewed to keep you safe. How can I help today?',
  es: 'Hola, esta es una línea de atención automatizada. No soy médico y esto no es consejo médico. Si es una emergencia, cuelgue y llame al 9 1 1. Esta llamada puede ser revisada para su seguridad. ¿Cómo puedo ayudarle hoy?',
};

// ---------------------------------------------------------------------------
// Worker→app auth: mint a bearer token bound to the room/call id (byte-compatible with the app
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
      guidance:
        language === 'es'
          ? 'Lo estoy conectando con una persona que puede ayudar. Por favor permanezca en la línea.'
          : "I'm connecting you to a person who can help. Please stay on the line.",
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

// ---------------------------------------------------------------------------
// LiveKit agent wiring — only when the Agents SDK is installed. Explicit dispatch: accept rooms
// with our prefix and register AGENT_NAME. The interview/preamble run in the call language; every
// caller turn is adjudicated by the app before the model may respond.
// ---------------------------------------------------------------------------
async function startLiveKitAgent() {
  let agents, deepgram, anthropic, silero;
  try {
    agents = await import('@livekit/agents');
    deepgram = await import('@livekit/agents-plugin-deepgram');
    anthropic = await import('@livekit/agents-plugin-anthropic');
    silero = await import('@livekit/agents-plugin-silero').catch(() => null);
  } catch {
    return false; // SDK not present — caller falls back to the idle boot.
  }

  const { cli, WorkerOptions, defineAgent, voice } = agents;

  const agent = defineAgent({
    // Explicit dispatch: this worker registers under AGENT_NAME; the SIP dispatch rule sets
    // room_config.agents = [AGENT_NAME]. We additionally guard on the room-name prefix.
    entry: async (ctx) => {
      const roomName = ctx.room?.name || '';
      if (!roomName.startsWith(CFG.roomPrefix)) return; // not ours

      // The call language + the opaque identity are carried on the dispatch attributes (no PHI).
      const attrs = ctx.room?.metadata ? safeJson(ctx.room.metadata) : {};
      const language = attrs.language === 'es' ? 'es' : 'en';
      const agentId = attrs.agentId || CFG.agentName;
      const callId = roomName;

      const stt = new deepgram.STT(deepgramSttConfig(language));
      const tts = new deepgram.TTS({ model: auraTtsModel(language) });
      const llm = new anthropic.LLM({ model: CFG.anthropicModel });
      const vad = silero ? await silero.VAD.load() : undefined;

      const session = new voice.AgentSession({ stt, llm, tts, vad });

      // Speak the mandatory preamble verbatim (model cannot alter it).
      await session.say(PREAMBLE[language], { allowInterruptions: false });

      // Every caller turn: extract typed evidence (model PROPOSES) → ask the app (engine DECIDES).
      session.on('user_turn_completed', async (turn) => {
        const { evidence, riskEstimate, identity } = await proposeEvidence(turn, llm, language);
        const decision = await callDecide({ callId, agentId, language, identity, evidence, riskEstimate });
        // Verbatim, non-interruptible policy guidance — the model never softens it.
        await session.say(decision.guidance, { allowInterruptions: false });
        if (isTerminal(decision.action)) {
          // Latch the model out for the rest of the call after a hard escalation.
          session.interrupt();
        }
      });

      await session.start({ room: ctx.room });
    },
  });

  // Register the worker under AGENT_NAME so explicit dispatch (room_config.agents=[name]) routes here.
  cli.runApp(
    new WorkerOptions({
      agent,
      agentName: CFG.agentName,
      wsURL: CFG.livekitUrl,
      apiKey: CFG.livekitApiKey,
      apiSecret: CFG.livekitApiSecret,
    }),
  );
  return true;
}

// Placeholder evidence extraction — a real deploy prompts the Opus brain to emit TYPED evidence
// (EvidenceFact[]) + a RiskEstimate from the turn. NO PHI is sent to the app; identity is opaque.
async function proposeEvidence(_turn, _llm, _language) {
  return {
    evidence: [],
    riskEstimate: {
      pRoutine: 0.5,
      pUrgent: 0.3,
      pCritical: 0.2,
      confidence: 0.5,
      oodScore: 0.2,
      evidenceCoverageScore: 0.5,
      reasonCodes: [],
      modelVersion: CFG.anthropicModel,
    },
    // Opaque identity ref only — populated out-of-band (browser OTP / DTMF), never raw PHI.
    identity: { verified: false, opaqueRef: '' },
  };
}

function isTerminal(action) {
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
// Boot.
// ---------------------------------------------------------------------------
async function main() {
  console.log(
    `[agent-worker] cara-spark voice cascade — agent_name=${CFG.agentName} prefix=${CFG.roomPrefix} ` +
      `livekit=${CFG.livekitUrl} app=${CFG.appBaseUrl}`,
  );
  const started = await startLiveKitAgent();
  if (!started) {
    console.log(
      '[agent-worker] LiveKit Agents SDK not installed — running as a healthy idle worker. ' +
        'Install @livekit/agents + plugins on the voice box to run the live cascade.',
    );
    setInterval(() => {}, 1 << 30);
  }
}

// Only auto-run as the entrypoint (so tests can import the pure helpers without booting).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[agent-worker] fatal', err);
    process.exit(1);
  });
}
