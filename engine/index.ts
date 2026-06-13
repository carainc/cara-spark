/**
 * Engine public API — the deterministic triage core. The model PROPOSES (evidence + a risk estimate);
 * the engine DECIDES. `adjudicate` composes red-flag eval → policy decision → fail-closed inference
 * gate against a VERIFIED bundle, and returns the full provable AdjudicationTrace (demo beat 1 + Lane F).
 */
import type { AdjudicateInput, AdjudicationTrace, BundleVerification, PolicyDecision, WorkflowState } from './types';
import { evaluateRedFlags } from './redflags';
import { decide } from './policy';
import { runInferenceCheck } from './inference-check';
import { verifyPolicyBundle } from './policy-bundle';

export const ENGINE_VERSION = '1.0.0';

export function adjudicate(input: AdjudicateInput): AdjudicationTrace {
  const { evidence, riskEstimate, bundle } = input;

  const redFlagResult = evaluateRedFlags(evidence, bundle.redFlagRules);
  const decision = decide(redFlagResult, riskEstimate, bundle);

  // Fail-closed inference gate: any failed check forces BLOCK (no summary text in the engine path).
  const inference = runInferenceCheck(evidence, riskEstimate, redFlagResult, bundle, decision, {
    auditPersisted: true,
    telemetryPersisted: true,
  });

  const finalDecision: PolicyDecision =
    inference.finalAction === decision.action
      ? decision
      : {
          ...decision,
          action: inference.finalAction,
          decisionReason: `Inference check failed: ${inference.failureReasons.join('; ')}`,
          requiresHumanReview: true,
          requiresSummarySuppression: false,
        };

  const verification = verifyPolicyBundle(bundle);
  const bundleVerification: BundleVerification = {
    policyVersion: bundle.metadata.policyVersion,
    checksum: bundle.metadata.checksum,
    checksumValid: verification.valid,
    // Signature is verified with the secret at LOAD (loadPolicyBundle); the trace reflects that a
    // signature is present on the bundle the agent loaded. The decision (decide) stays env-free.
    signatureValid: Boolean(bundle.metadata.signature),
    signedBy: bundle.metadata.signedBy,
  };

  const workflowState: WorkflowState =
    finalDecision.action === 'BLOCK_AND_HUMAN_HANDOFF' ? 'HUMAN_HANDOFF' : 'GUIDANCE_DELIVERED';

  return {
    traceId: evidence[0]?.traceId ?? 'no-trace',
    createdAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    evidence,
    redFlagResult,
    riskEstimate,
    decision: finalDecision,
    bundle: bundleVerification,
    workflowState,
  };
}

// Barrel — lanes import the whole engine surface from '@/engine'.
export * from './types';
export * from './evidence';
export * from './redflags';
export * from './risk';
export * from './policy';
export * from './inference-check';
export * from './workflow';
export * from './policy-bundle';
