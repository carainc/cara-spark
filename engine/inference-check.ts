/**
 * Inference-check — the fail-closed gate + anti-prompt-injection. Runs 12 checks; ANY failure forces
 * BLOCK_AND_HUMAN_HANDOFF (never silently downgrades). Combined with evidence.isAIGeneratedProse
 * (prose can't become evidence) and Check 9/10 (action must be in the signed bundle's allowed set; a
 * prohibited summary blocks), a model cannot inject an action, word a prohibited disposition, or smuggle
 * prose into the control path. Ported from VA-5. Pure — persistence is passed in as booleans.
 */
import type {
  AllowedAction,
  EvidenceFact,
  PolicyBundle,
  PolicyDecision,
  RedFlagResult,
  RiskEstimate,
} from './types';
import { allowedActionSchema, evidenceFactSchema } from './types';
import { verifyPolicyBundle } from './policy-bundle';

export interface CheckResult {
  passed: boolean;
  reason?: string;
}

export interface PersistenceFlags {
  auditPersisted: boolean;
  telemetryPersisted: boolean;
}

export interface InferenceCheckResult {
  passed: boolean;
  checks: Record<string, CheckResult>;
  failureReasons: string[];
  finalAction: AllowedAction;
}

function check(ok: boolean, reason: string): CheckResult {
  return ok ? { passed: true } : { passed: false, reason };
}

export function runInferenceCheck(
  evidence: EvidenceFact[],
  riskEstimate: RiskEstimate | null,
  redFlagResult: RedFlagResult | null,
  policyBundle: PolicyBundle,
  decision: PolicyDecision,
  persistenceFlags: PersistenceFlags,
  summaryText?: string,
): InferenceCheckResult {
  const checks: Record<string, CheckResult> = {};

  checks.schemaValid = check(
    evidence.every((f) => evidenceFactSchema.safeParse(f).success),
    'One or more evidence facts failed schema validation',
  );
  checks.provenanceValid = check(
    evidence.every((f) => Boolean(f.traceId) && Boolean(f.source) && Boolean(f.createdAt)),
    'Evidence missing provenance (traceId/source/createdAt)',
  );
  const verification = verifyPolicyBundle(policyBundle);
  checks.policyVerified = check(verification.valid, `Policy bundle invalid: ${verification.errors.join('; ')}`);
  checks.redFlagExecuted = check(
    Boolean(redFlagResult) && typeof redFlagResult!.triggered === 'boolean' && Array.isArray(redFlagResult!.hits),
    'Red-flag evaluation did not execute',
  );
  checks.riskExecuted = check(Boolean(riskEstimate), 'Risk estimate did not execute');
  checks.confidenceValid = check(
    Boolean(riskEstimate) && riskEstimate!.confidence >= 0 && riskEstimate!.confidence <= 1,
    'Confidence out of [0,1]',
  );
  checks.oodEvaluated = check(Boolean(riskEstimate) && typeof riskEstimate!.oodScore === 'number', 'OOD not evaluated');
  checks.coverageEvaluated = check(
    Boolean(riskEstimate) && typeof riskEstimate!.evidenceCoverageScore === 'number',
    'Evidence coverage not evaluated',
  );
  checks.actionAllowed = check(
    allowedActionSchema.safeParse(decision.action).success && policyBundle.allowedActions.includes(decision.action),
    `Action ${decision.action} not in the bundle's allowed set`,
  );
  checks.prohibitedOutputsClean = check(
    !summaryText ||
      !policyBundle.prohibitedOutputPatterns.some((p) => summaryText.toLowerCase().includes(p.toLowerCase())),
    'Summary contains a prohibited output pattern',
  );
  checks.auditPersisted = check(persistenceFlags.auditPersisted, 'Audit entry not persisted');
  checks.telemetryPersisted = check(persistenceFlags.telemetryPersisted, 'Telemetry not persisted');

  const failureReasons = Object.values(checks)
    .filter((c) => !c.passed)
    .map((c) => c.reason as string);
  const passed = failureReasons.length === 0;
  const finalAction: AllowedAction = passed ? decision.action : 'BLOCK_AND_HUMAN_HANDOFF';

  return { passed, checks, failureReasons, finalAction };
}
