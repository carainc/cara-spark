/**
 * Policy bundle (FR-2) — schema + checksum + version + sign/verify (T2 hardens this).
 * A bundle loads only if its checksum + signature are valid. `DEFAULT_POLICY` is real DATA
 * (so the engine has a bundle to run the moment T1 lands the functions); checksum/sign/verify
 * are NotImplemented stubs until T1/T2.
 *
 * Threshold values below are placeholders that T1 reconciles with VA-5's
 * DEFAULT_URGENCY_THRESHOLDS (see research/T1-va5-port-spec.md).
 */
import type { BundleVerification, PolicyBundle, RedFlagRule, UrgencyThresholds } from './types';
import { ALLOWED_ACTIONS } from './types';
import { notImplemented } from './_stub';

// Reconciled with VA-5 DEFAULT_URGENCY_THRESHOLDS (research/T1-va5-port-spec.md §2.1).
export const DEFAULT_URGENCY_THRESHOLDS: UrgencyThresholds = {
  abstentionThreshold: 0.3,
  oodThreshold: 0.7,
  reviewThreshold: 0.4,
  escalateThreshold: 0.7,
  urgentThreshold: 0.5,
  immediateCallbackThreshold: 0.8,
  selfCareConfidenceThreshold: 0.7,
};

/**
 * The demo's failsafe save (beat 1): an infant under 3 months with a fever ≥ 100.4°F (38°C)
 * is an emergency-department referral, full stop — the model cannot soften it.
 */
export const DEFAULT_RED_FLAG_RULES: RedFlagRule[] = [
  {
    id: 'infant-fever-floor',
    name: 'Infant fever floor',
    description: 'Infant < 3 months with temp ≥ 100.4°F (38°C) → emergency evaluation.',
    conditions: [
      { factType: 'patient_age_months', operator: 'lte', value: 3 },
      { factType: 'vital_temperature', operator: 'gte', value: 100.4 },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
];

export const DEFAULT_POLICY: PolicyBundle = {
  metadata: {
    policyVersion: 'default-0.1.0',
    checksum: '', // computed by T2's computeBundleChecksum
    signedBy: 'cara-spark-default',
    createdAt: '2026-06-13T00:00:00.000Z',
    changeNote: 'Hand-authored default bundle (T3 AI-builder was CUT).',
  },
  redFlagRules: DEFAULT_RED_FLAG_RULES,
  urgencyThresholds: DEFAULT_URGENCY_THRESHOLDS,
  allowedActions: [...ALLOWED_ACTIONS],
  prohibitedOutputPatterns: [
    // model must never emit a raw diagnosis/prescription or claim to be a clinician
    'you have been diagnosed',
    'i am a (doctor|nurse|physician)',
  ],
};

export function computeBundleChecksum(_bundle: PolicyBundle): string {
  return notImplemented('engine/policy-bundle.computeBundleChecksum');
}

export function signBundle(_bundle: PolicyBundle, _secret: string): PolicyBundle {
  return notImplemented('engine/policy-bundle.signBundle');
}

export function verifyPolicyBundle(_bundle: PolicyBundle, _secret: string): BundleVerification {
  return notImplemented('engine/policy-bundle.verifyPolicyBundle');
}
