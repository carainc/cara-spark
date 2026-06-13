/**
 * Lane D / T7 — THE LOOP. One turn end-to-end:
 *
 *   user message(s)
 *     → proposeAssessment()  [MODEL: Opus 4.8 extracts typed EvidenceFacts + RiskEstimate]
 *     → adjudicate()         [ENGINE: deterministic, fail-closed, red flags dominate — DECIDES]
 *     → buildTracePanel()    [render the canned guidance + the provable trace]
 *     → maybeBuildReferral() [ADVISORY RAG, NON-emergency only — decoration appended AFTER the
 *                             decision; can NEVER change the AllowedAction] (tk-0019)
 *
 * The model never picks the AllowedAction and never writes the guidance text — both come from the
 * engine's binding decision. That is the thesis, enforced by data flow: `adjudicate` consumes only
 * the typed evidence + risk, and `guidanceFor` is keyed by `trace.decision.action`.
 *
 * Multi-turn: the engine adjudicates EVERY turn (unchanged), but the panel carries a `turnMode`
 * (`buildTracePanel` → `decideTurnMode`) so the UI knows whether to CONVERSE (a no-red-flag, low
 * confidence/coverage block → keep gathering info) or PRESENT a final safe next step. Emergencies,
 * red flags, and fail-closed blocks always present — the decision itself is untouched here.
 *
 * tk-0012 / tk-0018: the loop adjudicates against `activePolicyBundle()` — the OSS DEFAULT_POLICY
 * SIGNED with VOICE_CONFIG_HMAC_SECRET when it is set — so the provable trace renders
 * "signature verified ✓" in the demo (and "unsigned" locally with no secret). The engine reads the
 * secret only to REPORT the verification; the deterministic decision stays env-free.
 *
 * Pure-ish: the only side effects are the injected `createMessage` (the model call) and the optional
 * injected referral `retrieve` (the RAG seam). Persistence is the caller's job (Lane F `recordCall`).
 * No DB here.
 */
import { adjudicate } from '@/engine';
import { activePolicyBundle } from '@/engine/policy-bundle';
import type { AdjudicationTrace, PolicyBundle } from '@/engine/types';
import type { ModelIdentityContext } from '@/lib/identity/model-context';
import type { Lang } from '@/lib/i18n';
import {
  proposeAssessment,
  type AgentCustomization,
  type AgentLang,
  type ChatTurn,
  type CreateMessage,
} from './extract';
import { buildTracePanel, type TracePanelView } from './guidance';
import { maybeBuildReferral, type ReferralDeps, type ReferralView } from './referral';

export interface RunTurnArgs {
  createMessage: CreateMessage;
  lang: Lang;
  identity: ModelIdentityContext;
  history: ChatTurn[];
  /**
   * Defaults to `activePolicyBundle()` — the signed-when-a-secret-is-set DEFAULT_POLICY the engine
   * runs against. Pass a bundle to override (e.g. a custom authored bundle).
   */
  bundle?: PolicyBundle;
  /**
   * Optional ADVISORY referral-RAG seam (tk-0019). When provided AND the engine's disposition is a
   * non-emergency one, a cited community resource is appended to the result. Omit it (local / no
   * embedding key) and the referral is simply skipped — the disposition is never affected.
   */
  referral?: ReferralDeps;
  /**
   * Optional per-agent TONE/STYLE customization (tk-0015) — persona / extra system-prompt text /
   * additional instructions. Threaded into the model's system prompt AFTER the hard rules, under a
   * guardrail. Tone-only by construction: it can shade voice/warmth but can NEVER change the
   * engine's disposition (the model still only proposes; the engine decides).
   */
  custom?: AgentCustomization;
  traceId?: string;
}

export interface RunTurnResult {
  trace: AdjudicationTrace;
  panel: TracePanelView;
  /** The model's NL reply — shown in the chat bubble only; never the clinical decision. */
  assistantText: string;
  /**
   * ADVISORY referral resource (food bank / CHC) appended AFTER a non-emergency disposition, or null.
   * Decision-inert: it cites a resource and carries the engine's already-decided action for display
   * copy — it can never alter `trace.decision.action`.
   */
  referral: ReferralView | null;
}

export async function runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
  const bundle = args.bundle ?? activePolicyBundle();
  const lang: AgentLang = args.lang === 'es' ? 'es' : 'en';

  // 1) MODEL PROPOSES — typed evidence + a risk estimate. No action, no PHI.
  const proposal = await proposeAssessment({
    createMessage: args.createMessage,
    lang,
    identity: args.identity,
    history: args.history,
    traceId: args.traceId,
    custom: args.custom,
  });

  // 2) ENGINE DECIDES — deterministic adjudication against the verified bundle. Binding.
  const trace = adjudicate({
    evidence: proposal.evidence,
    riskEstimate: proposal.riskEstimate,
    bundle,
  });

  // 3) RENDER — canned guidance keyed by the engine's action + the provable trace.
  const panel = buildTracePanel(trace, args.lang);

  // 4) ADVISORY RAG (tk-0019) — runs ONLY after the decision is final, takes the trace as read-only
  //    input, and returns decoration or null. For emergency dispositions it returns null (emergency
  //    first); on any RAG failure it degrades to null. It is structurally incapable of changing the
  //    action: it never feeds back into `adjudicate` and never writes `trace`/`panel.action`.
  //    tk-0027: a SDOH social-needs request lands on SELF_CARE_INFO_ONLY (engine lane), which is
  //    referral-eligible — so a pure "I'm looking for food" surfaces the community food-bank resource
  //    here, still decision-inert.
  const referral = await maybeBuildReferral(trace, args.lang, args.referral);

  return { trace, panel, assistantText: proposal.assistantText, referral };
}

export type { TracePanelView } from './guidance';
export type { AgentCustomization, ChatTurn, CreateMessage, AgentLang } from './extract';
export type { ReferralDeps, ReferralRetrieve, ReferralView } from './referral';
