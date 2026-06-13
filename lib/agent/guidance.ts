/**
 * Lane D / T7 — the ENGINE'S HALF, rendered. Given the deterministic AdjudicationTrace, assemble:
 *  - the CANNED guidance for the disposition (bilingual; keyed by the engine's AllowedAction, NEVER
 *    written by the model — so the model cannot soften a fired red flag), and
 *  - the provable-trace view-model (EvidenceFacts → rule fired → π → AllowedAction · bundle vN ·
 *    checksum ok · signature verified). Pure: no AI, no DB, no React. Unit-tested directly.
 */
import type { AdjudicationTrace, AllowedAction } from '@/engine/types';
import { SDOH_DECISION_REASON } from '@/engine/policy';
import { getDict, type Lang } from '@/lib/i18n';

/** Actions that are an emergency escalation the model may never override or soften. */
export const ESCALATION_ACTIONS: ReadonlySet<AllowedAction> = new Set([
  'ED_OR_911_GUIDANCE',
  'IMMEDIATE_CLINIC_CALLBACK',
  'BLOCK_AND_HUMAN_HANDOFF',
]);

/**
 * The chat is a real multi-turn CONVERSATION, not a one-shot per message. Each turn the engine still
 * adjudicates (unchanged, provable) — but we INTERPRET the result for the patient UI:
 *
 *  - 'converse' — the engine reached "not enough info YET". This is the NON-safety BLOCK: a
 *    BLOCK_AND_HUMAN_HANDOFF caused ONLY by low confidence (abstention) or low evidence coverage,
 *    with NO red flag. We keep talking: show the model's follow-up question and invite the next reply,
 *    NOT a scary "this needs a person" card.
 *  - 'present' — surface the safe next step NOW. EVERYTHING else: every confident routine/self-care/
 *    same-day/callback disposition, social-needs (SDOH) referrals, and — non-negotiably — every
 *    SAFETY outcome: a fired red flag, an emergency escalation (ED/911, immediate callback), or a
 *    genuine fail-closed BLOCK (signature invalid, OOD/out-of-distribution, inference-check failure).
 *
 * SAFETY DEFAULT: this returns 'present' unless it can POSITIVELY prove the block is the benign
 * low-info case. Any block we don't recognise, any red flag, any escalation → 'present'. When
 * uncertain, we present (fail safe) — an emergency can never be deferred or hidden behind "let's keep
 * chatting".
 */
export type TurnMode = 'present' | 'converse';

/**
 * The two deterministic decisionReason prefixes the engine stamps for the LOW-INFO block path
 * (engine/policy.ts steps 2 + 4). These are a frozen, documented contract — the policy file's own
 * comments quote them verbatim. We match on the prefix (the numeric thresholds vary by bundle).
 *
 * Crucially we do NOT include the OOD block ("OOD score … above threshold …"): an out-of-distribution
 * case is a genuine "this is unusual, get a human" signal, so it PRESENTS. Nor the signature-invalid
 * or inference-check-failed reasons — those are fail-closed SAFETY blocks that must present.
 */
const LOW_INFO_BLOCK_REASON_PREFIXES = ['Confidence ', 'Evidence coverage '] as const;

/**
 * Decide whether this turn CONTINUES the conversation or PRESENTS a final safe next step. Pure
 * function over the trace — no i18n, no React. This is the converse-vs-present rule, unit-tested
 * directly so the safety guarantee is provable: an emergency / red flag / fail-closed block always
 * yields 'present'; ONLY a no-red-flag, low-confidence-or-coverage BLOCK yields 'converse'.
 */
export function decideTurnMode(trace: AdjudicationTrace): TurnMode {
  // SAFETY FIRST: a fired red flag always presents — the patient must see it immediately. (Belt and
  // suspenders: a red flag forces an escalation action, not a BLOCK, but if a bundle ever routed a
  // red flag to BLOCK we still must present.)
  if (trace.redFlagResult.triggered) return 'present';

  const action = trace.decision.action;
  // Only a BLOCK is ever a candidate to "keep talking". Every non-block action is a real disposition
  // (self-care, routine, same-day, callback, ED/911, SDOH self-care) → present the next step.
  if (action !== 'BLOCK_AND_HUMAN_HANDOFF') return 'present';

  // It IS a block. Continue the conversation ONLY when it is provably the benign low-info path:
  // low confidence (abstention) or low evidence coverage. Anything else (OOD, signature-invalid,
  // inference-check failure, or any future reason) fails safe to 'present'.
  const reason = trace.decision.decisionReason;
  const isLowInfo = LOW_INFO_BLOCK_REASON_PREFIXES.some((p) => reason.startsWith(p));
  return isLowInfo ? 'converse' : 'present';
}

/** Map the engine's decision → the ONLY clinical text the UI shows. Sourced from the i18n dict. */
export function guidanceFor(action: AllowedAction, lang: Lang): string {
  return getDict(lang).agent.guidance[action];
}

export interface TraceEvidenceView {
  factType: string;
  value: unknown;
  source: string;
  confidence: number;
}

export interface TraceRuleView {
  ruleId: string;
  ruleName: string;
  action: AllowedAction;
}

/** The full provable-trace panel view-model (demo beat 1). Render-ready, PHI-free. */
export interface TracePanelView {
  action: AllowedAction;
  guidance: string;
  isEscalation: boolean;
  /**
   * Whether the patient UI should CONTINUE the conversation ('converse') or PRESENT a final safe next
   * step ('present'). Derived from the engine's decision via `decideTurnMode` — fail-safe to 'present'.
   * The trace itself is unchanged; this only interprets it for the chat.
   */
  turnMode: TurnMode;
  /** True when the engine routed a pure social/resource (SDOH) request — show community-resource copy + the referral, not clinical self-care text. */
  socialNeed: boolean;
  /** True when a red-flag rule fired → the model is structurally locked out of softening it. */
  redFlagFired: boolean;
  evidence: TraceEvidenceView[];
  rules: TraceRuleView[];
  risk: {
    pRoutine: number;
    pUrgent: number;
    pCritical: number;
    confidence: number;
  };
  decisionReason: string;
  bundleVersion: string;
  checksum: string;
  checksumValid: boolean;
  signaturePresent: boolean;
  signatureValid: boolean;
}

/**
 * Build the trace-panel view-model from a real AdjudicationTrace + the caller language. The guidance
 * is derived from `trace.decision.action` ONLY — there is no path here for model prose to become the
 * clinical instruction, which is what makes "the model cannot soften a fired red flag" structural.
 */
export function buildTracePanel(trace: AdjudicationTrace, lang: Lang): TracePanelView {
  const action = trace.decision.action;
  // A pure social/resource (SDOH) request maps to SELF_CARE_INFO_ONLY but must NOT show clinical
  // self-care copy ("rest, stay hydrated") — show community-resource framing; the loop appends the
  // (decision-inert) food-bank/referral citations below it.
  const socialNeed = trace.decision.decisionReason === SDOH_DECISION_REASON;
  return {
    action,
    guidance: socialNeed ? getDict(lang).agent.socialNeedGuidance : guidanceFor(action, lang),
    isEscalation: ESCALATION_ACTIONS.has(action),
    turnMode: decideTurnMode(trace),
    socialNeed,
    redFlagFired: trace.redFlagResult.triggered,
    evidence: trace.evidence.map((e) => ({
      factType: e.factType,
      value: e.value,
      source: e.source,
      confidence: e.confidence,
    })),
    rules: trace.redFlagResult.hits.map((h) => ({
      ruleId: h.ruleId,
      ruleName: h.ruleName,
      action: h.action,
    })),
    risk: {
      pRoutine: trace.riskEstimate.pRoutine,
      pUrgent: trace.riskEstimate.pUrgent,
      pCritical: trace.riskEstimate.pCritical,
      confidence: trace.riskEstimate.confidence,
    },
    decisionReason: trace.decision.decisionReason,
    bundleVersion: trace.bundle.policyVersion,
    checksum: trace.bundle.checksum,
    checksumValid: trace.bundle.checksumValid,
    signaturePresent: trace.bundle.signatureValid, // BundleVerification.signatureValid reflects presence at load
    signatureValid: trace.bundle.signatureValid,
  };
}
