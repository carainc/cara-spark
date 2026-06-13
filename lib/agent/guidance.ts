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
