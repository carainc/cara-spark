'use server';

/**
 * Lane D / T7 — the chat server action. Drives ONE turn of the failsafe loop from the browser:
 *   model PROPOSES typed evidence + risk → engine DECIDES → canned guidance + provable trace
 *   → ADVISORY referral (non-emergency only).
 *
 * It delegates to the unit-tested `runTurn` (lib/agent), so the demo beats flow through one path:
 *  - beat 1 "signature verified ✓": runTurn adjudicates against `activePolicyBundle()` — the signed
 *    default when VOICE_CONFIG_HMAC_SECRET is set — so the trace renders the verified signature.
 *  - beat 3 referral: a tenant-scoped, decision-inert RAG seam surfaces a cited community resource
 *    AFTER a non-emergency disposition. The seam is gated on the embedding key; without it the
 *    referral is simply skipped and the disposition is unaffected.
 *
 * Model-blindness is structural here: we build the identity block via `toModelIdentityContext`
 * (which has NO name/DOB parameter), and the chat history we send the model is symptom text the
 * patient typed. We never read or forward an identifier. Persistence (Lane F `recordCall`) stores the
 * PHI-free trace under an opaque identityRef only.
 */
import { activePolicyBundle } from '@/engine/policy-bundle';
import { recordCall } from '@/lib/audit/producer';
import { prisma } from '@/lib/db';
import { toModelIdentityContext } from '@/lib/identity/model-context';
import { unverifiedIdentity, type VerifiedIdentity } from '@/lib/identity/types';
import { runTurn, type TracePanelView, type ReferralView } from '@/lib/agent/loop';
import { defaultCreateMessage, type AgentCustomization, type ChatTurn } from '@/lib/agent/extract';
import {
  retrieveResources,
  createOpenAIEmbedder,
  isEmbeddingConfigured,
  pgStore,
  type ReferralCitation,
} from '@/lib/rag';
import type { ReferralDeps } from '@/lib/agent/referral';
import type { Lang } from '@/lib/i18n';

export interface TurnRequest {
  agentId?: string;
  lang: Lang;
  /** The full conversation so far; the latest user message is the last entry. */
  history: ChatTurn[];
  /** Opaque, model-safe identity ONLY. Never name/DOB. Defaults to unverified. */
  identity?: VerifiedIdentity;
}

export interface TurnResponse {
  ok: boolean;
  panel?: TracePanelView;
  assistantText?: string;
  /** ADVISORY referral (food bank / CHC) appended after a non-emergency disposition, or null. */
  referral?: ReferralView | null;
  error?: string;
}

/**
 * Build the ADVISORY referral-RAG seam for the chat loop (tk-0019). Tenant-scoped so one CHC's corpus
 * never leaks into another's referrals. Returns undefined when retrieval cannot run (no agent → no
 * tenant, or no embedding key) — the loop then simply skips the referral; the disposition is
 * unaffected. Decision-inert by construction: it imports lib/rag (citations only), never the engine.
 */
async function buildReferralDeps(agentId?: string): Promise<ReferralDeps | undefined> {
  if (!agentId) return undefined;
  if (!isEmbeddingConfigured()) return undefined;

  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { tenantId: true } });
  if (!agent) return undefined;

  const store = pgStore(prisma);
  const embed = createOpenAIEmbedder();
  return {
    tenantId: agent.tenantId,
    retrieve: async (args): Promise<ReferralCitation[]> =>
      retrieveResources(
        { tenantId: args.tenantId, query: args.query, language: args.language, topK: args.topK },
        { store, embed },
      ),
  };
}

/**
 * Load the agent's TONE/STYLE customization (tk-0015) — persona / extra system-prompt text /
 * additional instructions. These tune the conversational VOICE only; they are appended to the model
 * system prompt after the hard rules under a guardrail (see buildSystemPrompt) and can NEVER change
 * the engine's disposition. Returns undefined when there is no agent or no customization set, so the
 * base prompt is used unchanged. Best-effort: a DB hiccup here just means the default voice.
 */
async function loadAgentCustomization(agentId?: string): Promise<AgentCustomization | undefined> {
  if (!agentId) return undefined;
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { persona: true, systemPromptExtra: true, additionalInstructions: true },
  });
  if (!agent) return undefined;
  if (!agent.persona && !agent.systemPromptExtra && !agent.additionalInstructions) return undefined;
  return {
    persona: agent.persona,
    systemPromptExtra: agent.systemPromptExtra,
    additionalInstructions: agent.additionalInstructions,
  };
}

/**
 * Run a turn. The model call uses the BYO ANTHROPIC_API_KEY via `defaultCreateMessage`. On any model
 * error we fail safe to a generic message (the engine never sees malformed input — we just surface an
 * error). This action is intentionally thin: all logic lives in the unit-tested lib/agent modules.
 */
export async function submitTurn(req: TurnRequest): Promise<TurnResponse> {
  try {
    const identity = req.identity ?? unverifiedIdentity();
    const modelIdentity = toModelIdentityContext(identity);
    const lang = req.lang === 'es' ? 'es' : 'en';

    // The signed-when-a-secret-is-set default bundle — the engine verifies + reports its signature.
    const bundle = activePolicyBundle();
    const createMessage = await defaultCreateMessage();
    // Best-effort RAG seam; failure to build it just means no referral (never blocks the turn).
    const referralDeps = await buildReferralDeps(req.agentId).catch(() => undefined);
    // Best-effort TONE/STYLE customization; failure just means the default voice (never blocks the turn).
    const custom = await loadAgentCustomization(req.agentId).catch(() => undefined);

    // MODEL PROPOSES → ENGINE DECIDES → canned guidance + provable trace → advisory referral.
    // `custom` is tone-only: it shades the voice in the system prompt but cannot change the disposition.
    const { trace, panel, assistantText, referral } = await runTurn({
      createMessage,
      lang,
      identity: modelIdentity,
      history: req.history,
      bundle,
      referral: referralDeps,
      custom,
    });

    // PERSIST the PHI-free trace (failsafe save — demo beat 1). Best-effort: a DB hiccup must not
    // break the patient's guidance, so we swallow persistence errors after the decision is made.
    if (req.agentId) {
      try {
        await recordCall(prisma, {
          agentId: req.agentId,
          channel: 'CHAT',
          language: lang === 'es' ? 'ES' : 'EN',
          identityRef: identity.opaqueRef || undefined,
          traces: [trace],
          bundle,
        });
      } catch {
        // intentionally ignored — the disposition is already final and shown to the patient.
      }
    }

    return { ok: true, panel, assistantText, referral };
  } catch (err) {
    // Surface server-side so a misconfig (bad key, rejected model/params) is diagnosable in logs.
    // The patient still sees only the safe generic error — no internals leak to the browser.
    console.error('[agent] submitTurn failed:', err instanceof Error ? err.message : err);
    return { ok: false, error: 'turn_failed' };
  }
}
