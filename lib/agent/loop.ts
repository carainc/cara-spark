/**
 * Lane D / T7 — THE LOOP. One turn end-to-end:
 *
 *   user message(s)
 *     → proposeAssessment()  [MODEL: Opus 4.8 extracts typed EvidenceFacts + RiskEstimate]
 *     → adjudicate()         [ENGINE: deterministic, fail-closed, red flags dominate — DECIDES]
 *     → buildTracePanel()    [render the canned guidance + the provable trace]
 *
 * The model never picks the AllowedAction and never writes the guidance text — both come from the
 * engine's binding decision. That is the thesis, enforced by data flow: `adjudicate` consumes only
 * the typed evidence + risk, and `guidanceFor` is keyed by `trace.decision.action`.
 *
 * Pure-ish: the only side effect is the injected `createMessage` (the model call). Persistence is the
 * caller's job (Lane F `recordCall`). No DB here.
 */
import { adjudicate } from '@/engine';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';
import type { AdjudicationTrace, PolicyBundle } from '@/engine/types';
import type { ModelIdentityContext } from '@/lib/identity/model-context';
import type { Lang } from '@/lib/i18n';
import {
  proposeAssessment,
  type AgentLang,
  type ChatTurn,
  type CreateMessage,
} from './extract';
import { buildTracePanel, type TracePanelView } from './guidance';

export interface RunTurnArgs {
  createMessage: CreateMessage;
  lang: Lang;
  identity: ModelIdentityContext;
  history: ChatTurn[];
  /** Defaults to the signed DEFAULT_POLICY bundle (the OSS default the engine runs against). */
  bundle?: PolicyBundle;
  traceId?: string;
}

export interface RunTurnResult {
  trace: AdjudicationTrace;
  panel: TracePanelView;
  /** The model's NL reply — shown in the chat bubble only; never the clinical decision. */
  assistantText: string;
}

export async function runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
  const bundle = args.bundle ?? DEFAULT_POLICY;
  const lang: AgentLang = args.lang === 'es' ? 'es' : 'en';

  // 1) MODEL PROPOSES — typed evidence + a risk estimate. No action, no PHI.
  const proposal = await proposeAssessment({
    createMessage: args.createMessage,
    lang,
    identity: args.identity,
    history: args.history,
    traceId: args.traceId,
  });

  // 2) ENGINE DECIDES — deterministic adjudication against the verified bundle. Binding.
  const trace = adjudicate({
    evidence: proposal.evidence,
    riskEstimate: proposal.riskEstimate,
    bundle,
  });

  // 3) RENDER — canned guidance keyed by the engine's action + the provable trace.
  const panel = buildTracePanel(trace, args.lang);

  return { trace, panel, assistantText: proposal.assistantText };
}

export type { TracePanelView } from './guidance';
export type { ChatTurn, CreateMessage, AgentLang } from './extract';
