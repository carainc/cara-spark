/**
 * Layer 4 — Deterministic policy adjudication (FR-6). Maps {red-flag result, risk estimate, bundle}
 * → one AllowedAction. Priority: red-flag dominance → abstention(conf) → abstention(OOD) → SDOH
 * social-needs lane → evidence insufficiency → critical → urgent → routine. Deterministic,
 * fail-closed, red flags dominate. Ported from VA-5 (policy-engine.ts). Pure — no AI, no DB, no
 * clock, no randomness.
 *
 * tk-0027 — SDOH social-needs lane. A PURE resource request (food / housing / transport / utilities)
 * carries almost no clinical evidence, so the fail-closed low-coverage BLOCK used to route it to a
 * human ("Evidence coverage 0.10 below review threshold 0.4") — wrong: it should surface community
 * resources (the referral RAG), not "this needs a person." The lane DOWN-classifies such a request to
 * SELF_CARE_INFO_ONLY (a non-blocking, referral-eligible disposition) — but ONLY when there is ZERO
 * clinical signal. It is fail-SAFE by construction: it can never down-classify a request that carries
 * any clinical symptom / vital / lab / mental-health fact, fires no red flag (red flags dominate
 * above it), and yields only on low clinical risk. See `isPureSocialNeed`.
 */
import type { AllowedAction, EvidenceFact, PolicyBundle, PolicyDecision, RedFlagResult, RiskEstimate } from './types';
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

/**
 * tk-0027 — the social/resource (SDOH) allowlist. CONSERVATIVE by design: a tight, documented set of
 * substrings naming a non-clinical community need (food, housing, transport, utilities, clothing). A
 * value must MATCH one of these to count as a social need; anything else is treated as clinical. Kept
 * lowercase; matched as a substring against a lowercased fact value so "I am looking for food",
 * "need groceries", "facing eviction", "transportation" all hit. Tight on purpose: broadening this is
 * a deliberate, reviewed change — never a silent one.
 */
export const SOCIAL_NEED_KEYWORDS: readonly string[] = [
  'food',
  'hunger',
  'hungry',
  'meal',
  'meals',
  'groceries',
  'grocery',
  'housing',
  'shelter',
  'homeless',
  'rent',
  'eviction',
  'transport',
  'transportation',
  'ride',
  'utilities',
  'utility',
  'clothing',
  'clothes',
] as const;

/**
 * Fact types whose VALUE may name a social need. The need is typed by the model as a
 * chief_complaint / condition / symptom string ("seeking food / hunger"). A numeric or
 * clinical-signal fact (a vital, a lab, an age) can NEVER carry a social need — it is clinical signal.
 */
const SOCIAL_NEED_FACT_TYPES: ReadonlySet<string> = new Set(['chief_complaint', 'condition', 'symptom']);

/**
 * Fact types that, when present, are clinical signal and HARD-DISQUALIFY the social lane regardless of
 * any social keyword. These are the symptom / vital / lab / medication / allergy / mental-health /
 * clinical-context types the clinical engine governs. `chief_complaint` / `condition` / `symptom` are
 * NOT here: they are the carrier of the social need and are judged by VALUE in `isPureSocialNeed`.
 */
const CLINICAL_SIGNAL_FACT_TYPES: ReadonlySet<string> = new Set([
  'vital_sign',
  'vital_temperature',
  'patient_age_months',
  'lab_value',
  'medication',
  'allergy',
  'document_finding',
  'mental_health',
  'severity',
]);

/** Does this fact value (a string) name a need on the social allowlist? Lowercased substring match. */
function valueMatchesSocialNeed(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.toLowerCase();
  return SOCIAL_NEED_KEYWORDS.some((kw) => v.includes(kw));
}

/**
 * tk-0027 — the fail-SAFE gate for the SDOH lane. Returns true ONLY for a request that is purely a
 * social/resource need with ZERO clinical signal. Three conditions, ALL required:
 *
 *   1. At least one chief_complaint / condition / symptom value matches the social allowlist.
 *   2. NO clinical-signal fact is present (no vital / lab / medication / allergy / age / mental-health
 *      / document-finding / severity), AND every chief_complaint / condition / symptom value present
 *      is itself a social-allowlist match — so a genuine clinical symptom (e.g. "chest_pain") riding
 *      alongside "food" DISQUALIFIES the lane (that value is non-social → clinical signal).
 *   3. (Risk is checked by the caller: pUrgent / pCritical below the urgent / escalate thresholds.)
 *
 * The effect: the lane only ever fires when the engine sees a resource ask and nothing a clinician
 * would triage. Any clinical fact — typed or symptomatic — keeps the clinical engine in control.
 */
export function isPureSocialNeed(evidence: readonly EvidenceFact[]): boolean {
  if (evidence.length === 0) return false;

  let sawSocialNeed = false;
  for (const fact of evidence) {
    // Any hard clinical-signal fact present → not a pure social need. Fail safe to the clinical engine.
    if (CLINICAL_SIGNAL_FACT_TYPES.has(fact.factType)) return false;

    if (SOCIAL_NEED_FACT_TYPES.has(fact.factType)) {
      if (valueMatchesSocialNeed(fact.value)) {
        sawSocialNeed = true;
      } else {
        // A chief_complaint / condition / symptom that is NOT on the allowlist is a clinical symptom
        // (e.g. "chest_pain", "headache"). Its presence means real clinical signal → disqualify.
        return false;
      }
    }
    // Other fact types (duration, history, etc.) are neither clinical-signal nor social-need carriers;
    // they neither qualify nor disqualify on their own. The social need + no-clinical-signal gate above
    // is what governs.
  }

  return sawSocialNeed;
}

/**
 * tk-0027 — the single decisionReason the SDOH lane stamps. Exported so the presentation layer can
 * key social-needs copy off it (a pure resource request must NOT show clinical self-care text like
 * "rest and stay hydrated"). The engine still decides SELF_CARE_INFO_ONLY; this is only the marker.
 */
export const SDOH_DECISION_REASON =
  'social/resource need — routed to community resources, no clinical concern detected';

export function decide(
  redFlagResult: RedFlagResult,
  riskEstimate: RiskEstimate,
  bundle: PolicyBundle,
  /**
   * tk-0027 — the typed evidence, used ONLY by the SDOH social-needs lane to detect a pure
   * resource request. OPTIONAL and backward-compatible: callers that omit it (e.g. audit
   * what-if probes) get the unchanged clinical behavior — the social lane simply never fires
   * without evidence to inspect, which is the fail-safe direction.
   */
  evidence: readonly EvidenceFact[] = [],
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
  // 3b. SDOH SOCIAL-NEEDS LANE (tk-0027) — runs AFTER red-flag/abstention/OOD (so an uncertain or
  //     out-of-distribution input still fails closed) but BEFORE the low-coverage BLOCK it bypasses.
  //     A PURE social/resource request (food / housing / transport / utilities) with ZERO clinical
  //     signal and LOW clinical risk is NOT a thin clinical case — it is a community-resource ask. We
  //     route it to a non-blocking SELF_CARE_INFO_ONLY (referral-eligible) instead of fail-closing to
  //     a human. Fail-SAFE: it only DOWN-classifies a request the clinical engine has no signal on
  //     (no red flag here by construction; no clinical fact; risk below the urgent/escalate
  //     thresholds). Any clinical signal keeps the clinical engine (steps 4–7) unchanged.
  if (
    riskEstimate.pUrgent < t.urgentThreshold &&
    riskEstimate.pCritical < t.escalateThreshold &&
    isPureSocialNeed(evidence)
  ) {
    return {
      action: 'SELF_CARE_INFO_ONLY',
      decisionReason: SDOH_DECISION_REASON,
      policyVersion,
      ruleIdsApplied: [],
      requiresHumanReview: false,
      requiresSummarySuppression: false,
    };
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
