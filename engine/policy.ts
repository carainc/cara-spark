/**
 * Layer 4 — Deterministic policy adjudication (FR-6). Maps {red-flag result, risk estimate, bundle}
 * → one AllowedAction. Priority: red-flag dominance → abstention(conf) → abstention(OOD) → evidence
 * insufficiency → critical → urgent → routine. Deterministic, fail-closed, red flags dominate.
 * Ported from VA-5 (policy-engine.ts). Pure — no AI, no DB, no clock, no randomness.
 */
import type { AllowedAction, PolicyBundle, PolicyDecision, RedFlagResult, RiskEstimate } from './types';
import { ACTION_SEVERITY } from './types';

function block(reason: string, policyVersion: string): PolicyDecision {
  return {
    action: 'BLOCK_AND_HUMAN_HANDOFF',
    decisionReason: reason,
    policyVersion,
    ruleIdsApplied: [],
    requiresHumanReview: true,
    requiresSummarySuppression: false,
  };
}

export function decide(
  redFlagResult: RedFlagResult,
  riskEstimate: RiskEstimate,
  bundle: PolicyBundle,
): PolicyDecision {
  const t = bundle.urgencyThresholds;
  const policyVersion = bundle.metadata.policyVersion;

  // 1. RED-FLAG ESCALATION — always dominates; probabilities never consulted.
  if (redFlagResult.triggered && redFlagResult.hits.length > 0) {
    const ruleIdsApplied: string[] = [];
    let action: AllowedAction = redFlagResult.hits[0].action;
    let severity = ACTION_SEVERITY[action];
    for (const hit of redFlagResult.hits) {
      ruleIdsApplied.push(hit.ruleId);
      if (ACTION_SEVERITY[hit.action] > severity) {
        severity = ACTION_SEVERITY[hit.action];
        action = hit.action;
      }
    }
    return {
      action,
      decisionReason: `Red flag triggered: ${redFlagResult.hits.map((h) => h.ruleName).join(', ')}`,
      policyVersion,
      ruleIdsApplied,
      requiresHumanReview: true,
      requiresSummarySuppression: action === 'ED_OR_911_GUIDANCE',
    };
  }

  // 2. ABSTENTION — low confidence (strict <).
  if (riskEstimate.confidence < t.abstentionThreshold) {
    return block(
      `Confidence ${riskEstimate.confidence.toFixed(2)} below abstention threshold ${t.abstentionThreshold}`,
      policyVersion,
    );
  }
  // 3. ABSTENTION — high OOD (strict >).
  if (riskEstimate.oodScore > t.oodThreshold) {
    return block(`OOD score ${riskEstimate.oodScore.toFixed(2)} above threshold ${t.oodThreshold}`, policyVersion);
  }
  // 4. EVIDENCE INSUFFICIENCY (strict <).
  if (riskEstimate.evidenceCoverageScore < t.reviewThreshold) {
    return block(
      `Evidence coverage ${riskEstimate.evidenceCoverageScore.toFixed(2)} below review threshold ${t.reviewThreshold}`,
      policyVersion,
    );
  }
  // 5. CRITICAL (inclusive >=).
  if (riskEstimate.pCritical >= t.escalateThreshold) {
    return {
      action: 'ED_OR_911_GUIDANCE',
      decisionReason: `pCritical ${riskEstimate.pCritical.toFixed(2)} >= escalate threshold ${t.escalateThreshold}`,
      policyVersion,
      ruleIdsApplied: [],
      requiresHumanReview: true,
      requiresSummarySuppression: true,
    };
  }
  // 6. URGENT.
  if (riskEstimate.pUrgent >= t.urgentThreshold) {
    const action: AllowedAction =
      riskEstimate.pUrgent >= t.immediateCallbackThreshold ? 'IMMEDIATE_CLINIC_CALLBACK' : 'SAME_DAY_REVIEW';
    return {
      action,
      decisionReason: `pUrgent ${riskEstimate.pUrgent.toFixed(2)} >= urgent threshold ${t.urgentThreshold}`,
      policyVersion,
      ruleIdsApplied: [],
      requiresHumanReview: false,
      requiresSummarySuppression: false,
    };
  }
  // 7. ROUTINE (fall-through).
  const action: AllowedAction =
    riskEstimate.confidence >= t.selfCareConfidenceThreshold ? 'SELF_CARE_INFO_ONLY' : 'ROUTINE_REVIEW';
  return {
    action,
    decisionReason: `Routine: pRoutine ${riskEstimate.pRoutine.toFixed(2)}, confidence ${riskEstimate.confidence.toFixed(2)}`,
    policyVersion,
    ruleIdsApplied: [],
    requiresHumanReview: false,
    requiresSummarySuppression: false,
  };
}
