/**
 * GET /api/voice/config/[room] — the Spark→prod-voice config bridge (tk-0026).
 *
 * THE SEAM: the proven cara-prod voice cascade worker already fetches per-call config as
 *   GET {VOICE_CONFIG_URL}/{room}?tenant=<t>&agentRef=<a>&did=<d>
 *   Authorization: Bearer cara-voicecfg-v1.<nonce>.<sig>
 * and expects JSON { systemPrompt, agentRef, voiceEngine, greeting, identityRequired }. Today
 * VOICE_CONFIG_URL is UNSET in prod, so the cascade falls back to a single static prompt. If
 * VOICE_CONFIG_URL is pointed at THIS route, the prod cascade runs the SPARK-authored config —
 * inheriting Spark's model-blind, propose-only safety framing PLUS the authored persona. Spark
 * already implements the byte-identical `cara-voicecfg-v1` HMAC scheme (lib/voice/config-signature),
 * so the same worker token verifies here unchanged.
 *
 * LAW OF THIS ROUTE:
 *  • FAIL CLOSED on auth. Absent / forged / wrong-room bearer → 401. We NEVER serve config
 *    unauthenticated (the token is HMAC-bound to the room — the path param).
 *  • FAIL CLOSED on resolution. An unknown / unpublished agent → 404, so the cascade keeps its
 *    safe static fallback rather than speaking as a draft or wrong agent.
 *  • MODEL-BLIND, no PHI. The served systemPrompt is built by `buildSystemPrompt` from an
 *    UNVERIFIED identity context (no name/DOB ever) + the agent's TONE-only customization. It
 *    retains the no-identifier + propose-only + never-state-a-disposition rules. The greeting is
 *    the canned not-emergency spoken disclaimer. We never read or echo the caller's number.
 *  • DETERMINISTIC-ENGINE thesis preserved. We serve a prompt + greeting; we never serve a
 *    disposition. (See the honest-limitation note in the task: full engine-gating on the prod path
 *    would additionally require the prod cascade to call /api/voice/decide per turn — out of scope.)
 *
 * Node runtime required (HMAC via node:crypto).
 */
import { prisma } from '@/lib/db';
import { resolveConfigAgent } from '@/lib/voice/routing';
import { buildSystemPrompt, type AgentCustomization } from '@/lib/agent/extract';
import { toModelIdentityContext } from '@/lib/identity/model-context';
import { unverifiedIdentity } from '@/lib/identity/types';
import { spokenDisclaimer } from '@/lib/kiosk/spoken';
import { authorizeWorker } from '../../_auth';

export const runtime = 'nodejs';

/**
 * The config shape the prod cascade's `fetch_call_config` expects. `voiceEngine` is fixed to
 * 'cascade' (the prod path is the cascade worker). `identityRequired` is false: identity is
 * captured OUT-OF-BAND and is optional for symptom-gathering (OSS law #3, model-blind) — the
 * cascade must never demand an identifier mid-call, which the systemPrompt also forbids.
 */
interface VoiceConfigResponse {
  systemPrompt: string;
  agentRef: string;
  voiceEngine: 'cascade';
  greeting: string;
  identityRequired: boolean;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ room: string }> },
): Promise<Response> {
  const { room } = await ctx.params;

  // FAIL CLOSED on auth FIRST — before any DB lookup. The bearer is HMAC-bound to the room (the
  // per-call session binding the prod worker signs over). Absent / forged / wrong-room → 401.
  if (!authorizeWorker(req, room)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Per-call config inputs. agentRef/did/tenant are opaque routing ids; the DID is matched inside
  // `resolveConfigAgent` but never logged or echoed (no PHI).
  const url = new URL(req.url);
  const did = url.searchParams.get('did');
  const agentRef = url.searchParams.get('agentRef');

  const agent = await resolveConfigAgent(prisma, { room, did, agentRef });
  if (!agent) {
    // FAIL CLOSED: no published agent owns this call → the cascade keeps its safe static fallback.
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // The agent's TONE/STYLE customization (tk-0015) — appended AFTER the hard rules under a guardrail
  // by buildSystemPrompt; it can shade voice but never override the engine or the model-blind rules.
  const custom: AgentCustomization = {
    persona: agent.persona,
    systemPromptExtra: agent.systemPromptExtra,
    additionalInstructions: agent.additionalInstructions,
  };

  // Model-blind by construction: the identity block comes from an UNVERIFIED context (no name/DOB
  // parameter exists). The served prompt therefore carries the no-identifier + propose-only +
  // never-state-a-disposition framing PLUS the authored persona.
  const systemPrompt = buildSystemPrompt(
    agent.language,
    toModelIdentityContext(unverifiedIdentity()),
    custom,
  );

  const body: VoiceConfigResponse = {
    systemPrompt,
    agentRef: agent.id, // the canonical resolved Spark agent id
    voiceEngine: 'cascade',
    greeting: spokenDisclaimer(agent.language), // the not-emergency spoken disclaimer (i18n)
    identityRequired: false,
  };

  return Response.json(body, { status: 200 });
}
