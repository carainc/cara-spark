'use server';

/**
 * Lane D / T7 — the chat server action. Drives ONE turn of the failsafe loop from the browser:
 *   model PROPOSES typed evidence + risk → engine DECIDES → canned guidance + provable trace.
 *
 * Model-blindness is structural here: we build the identity block via `toModelIdentityContext`
 * (which has NO name/DOB parameter), and the chat history we send the model is symptom text the
 * patient typed. We never read or forward an identifier. Persistence (Lane F `recordCall`) stores the
 * PHI-free trace under an opaque identityRef only.
 */
import { adjudicate } from '@/engine';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';
import { recordCall } from '@/lib/audit/producer';
import { prisma } from '@/lib/db';
import { toModelIdentityContext } from '@/lib/identity/model-context';
import { unverifiedIdentity, type VerifiedIdentity } from '@/lib/identity/types';
import { buildTracePanel, type TracePanelView } from '@/lib/agent/guidance';
import { proposeAssessment, defaultCreateMessage, type ChatTurn } from '@/lib/agent/extract';
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
  error?: string;
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

    const createMessage = await defaultCreateMessage();

    // 1) MODEL PROPOSES (no action, no PHI).
    const proposal = await proposeAssessment({
      createMessage,
      lang,
      identity: modelIdentity,
      history: req.history,
    });

    // 2) ENGINE DECIDES — binding.
    const trace = adjudicate({
      evidence: proposal.evidence,
      riskEstimate: proposal.riskEstimate,
      bundle: DEFAULT_POLICY,
    });

    // 3) PERSIST the PHI-free trace (failsafe save — demo beat 1). Best-effort: a DB hiccup must not
    //    break the patient's guidance, so we swallow persistence errors after the decision is made.
    if (req.agentId) {
      try {
        await recordCall(prisma, {
          agentId: req.agentId,
          channel: 'CHAT',
          language: lang === 'es' ? 'ES' : 'EN',
          identityRef: identity.opaqueRef || undefined,
          traces: [trace],
          bundle: DEFAULT_POLICY,
        });
      } catch {
        // intentionally ignored — the disposition is already final and shown to the patient.
      }
    }

    return {
      ok: true,
      panel: buildTracePanel(trace, req.lang),
      assistantText: proposal.assistantText,
    };
  } catch {
    return { ok: false, error: 'turn_failed' };
  }
}
