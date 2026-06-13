/**
 * Engine public API — the deterministic triage core. The model PROPOSES (evidence + a risk estimate);
 * the engine DECIDES. `adjudicate` composes red-flag eval → policy decision → fail-closed inference
 * gate against a VERIFIED bundle, and returns the full provable AdjudicationTrace (demo beat 1 + Lane F).
 */
import type { AdjudicateInput, AdjudicationTrace, BundleVerification, PolicyDecision, WorkflowState } from './types';
import { evaluateRedFlags } from './redflags';
import { decide } from './policy';
import { runInferenceCheck } from './inference-check';
import { verifyBundleSignature, verifyPolicyBundle, registerBundle } from './policy-bundle';
import { FAMILYMED_BUNDLE_VERSION, activeFamilymedBundle, FAMILYMED_BUNDLE_METADATA } from './familymed-bundle';

export const ENGINE_VERSION = '1.0.0';

// Register the familymed-v1 bundle (tk-0025) at module load so every consumer of the registry
// (GET /api/bundles, the audit re-verify resolver, the loop's per-agent resolution) sees it. Done
// here — not in policy-bundle.ts — because familymed-bundle.ts imports the create/sign helpers from
// policy-bundle.ts, so registering there would be a cycle.
registerBundle({
  version: FAMILYMED_BUNDLE_VERSION,
  build: activeFamilymedBundle,
  isDefault: false,
  author: FAMILYMED_BUNDLE_METADATA.author,
  source: FAMILYMED_BUNDLE_METADATA.source,
});

/** fail-closed reason surfaced when a bundle claims a signature that does not verify (tk-0020). */
const SIGNATURE_INVALID_REASON = 'policy bundle signature invalid — fail-closed; not adjudicated';

export function adjudicate(input: AdjudicateInput): AdjudicationTrace {
  const { evidence, riskEstimate, bundle } = input;

  // tk-0018: signatureValid is a REAL HMAC verify — a forged/empty/wrong signature is REJECTED
  // (presence alone never passes). The secret is read here (orchestrator) only to report the
  // verification in the trace; the DECISION (decide) stays pure/env-free. Callers adjudicate against a
  // signed bundle via activePolicyBundle(), so the demo trace shows "signature verified ✓".
  const hmacSecret = process.env.VOICE_CONFIG_HMAC_SECRET;
  const verification = verifyPolicyBundle(bundle);
  const bundleVerification: BundleVerification = {
    policyVersion: bundle.metadata.policyVersion,
    checksum: bundle.metadata.checksum,
    checksumValid: verification.valid,
    signatureValid:
      Boolean(bundle.metadata.signature) && Boolean(hmacSecret) && verifyBundleSignature(bundle, hmacSecret as string),
    signedBy: bundle.metadata.signedBy,
  };

  // tk-0020 (fail-CLOSED): a bundle that CLAIMS a signature (metadata.signature set) but does NOT
  // verify is forged/tampered. REFUSE to adjudicate against it — do NOT trust its rules/thresholds.
  // Return the most conservative action and never consult the unverified bundle's policy. An UNSIGNED
  // bundle (no metadata.signature) is unaffected and still flows through the normal path below.
  const claimsSignature = Boolean(bundle.metadata.signature);
  if (claimsSignature && !bundleVerification.signatureValid) {
    const failClosedDecision: PolicyDecision = {
      action: 'BLOCK_AND_HUMAN_HANDOFF',
      decisionReason: SIGNATURE_INVALID_REASON,
      policyVersion: bundle.metadata.policyVersion,
      ruleIdsApplied: [],
      requiresHumanReview: true,
      requiresSummarySuppression: false,
    };
    return {
      traceId: evidence[0]?.traceId ?? 'no-trace',
      createdAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      evidence,
      // Empty red-flag result — the untrusted bundle's rules are NOT executed.
      redFlagResult: { triggered: false, hits: [] },
      riskEstimate,
      decision: failClosedDecision,
      bundle: bundleVerification,
      workflowState: 'HUMAN_HANDOFF',
    };
  }

  const redFlagResult = evaluateRedFlags(evidence, bundle.redFlagRules);
  // tk-0027: evidence is threaded into decide() so the deterministic SDOH social-needs lane can detect
  // a pure resource request. It only ever down-classifies a request with zero clinical signal; any
  // clinical fact (and red flags, evaluated above) keep the clinical decision unchanged.
  const decision = decide(redFlagResult, riskEstimate, bundle, evidence);

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
export * from './familymed-bundle';
