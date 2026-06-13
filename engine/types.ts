/**
 * ⛓ FROZEN CONTRACT #1 of 4 — the triage engine's data contract.
 *
 * All 6 build lanes import from here. Changing a frozen contract mid-build is a
 * COORDINATED edit logged in RUN_STATE.md — never silent. (runbook §4.5)
 *
 * Mirrors the shipped VA-5 adjudicator (pulse-mgmt-crm/lib/triage/types.ts) so T1 is a
 * PORT, not a rebuild — plus the three names the demo trace panel needs:
 * `AllowedAction` (the finite action enum), `AdjudicationTrace` (the provable/replayable
 * trace), and a forward-only `WorkflowState`.
 *
 * Pure data — no runtime deps beyond zod. The engine that consumes these types is a
 * DETERMINISTIC pure function: the model PROPOSES evidence + a risk estimate, the engine
 * DECIDES. No AI calls, no DB, in the adjudication path.
 */
import { z } from 'zod';

// =============================================================================
// Allowed Actions (FR-5) — the finite, closed set. No other action is permitted.
// =============================================================================

/** The 6 allowed actions, ordered lowest → highest escalation severity. */
export const ALLOWED_ACTIONS = [
  'SELF_CARE_INFO_ONLY',
  'ROUTINE_REVIEW',
  'SAME_DAY_REVIEW',
  'IMMEDIATE_CLINIC_CALLBACK',
  'ED_OR_911_GUIDANCE',
  'BLOCK_AND_HUMAN_HANDOFF',
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];
export const allowedActionSchema = z.enum(ALLOWED_ACTIONS);

/** VA-5 parity aliases — keep T1's port a drop-in. */
export const TRIAGE_ACTIONS = ALLOWED_ACTIONS;
export type TriageAction = AllowedAction;

/** Severity rank for deterministic ordering. Higher = more severe. */
export const ACTION_SEVERITY: Record<AllowedAction, number> = {
  SELF_CARE_INFO_ONLY: 0,
  ROUTINE_REVIEW: 1,
  SAME_DAY_REVIEW: 2,
  IMMEDIATE_CLINIC_CALLBACK: 3,
  ED_OR_911_GUIDANCE: 4,
  BLOCK_AND_HUMAN_HANDOFF: 5,
};

// =============================================================================
// Evidence Model (FR-1)
// =============================================================================

export const EVIDENCE_SOURCES = [
  'user_chat',
  'form_submission',
  'ocr',
  'uploaded_document',
  'ehr',
  'clinician_confirmed',
  'verified_guideline',
  'voice_transcript',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const SOURCE_TRUST_LEVELS = ['low', 'medium', 'high'] as const;
export type SourceTrust = (typeof SOURCE_TRUST_LEVELS)[number];

export interface EvidenceFact {
  id: string;
  factType: string;
  value: unknown;
  confidence: number;
  source: EvidenceSource;
  sourceTrust: SourceTrust;
  verified: boolean;
  createdAt: string;
  modelVersion?: string;
  policyVersionSeen?: string;
  traceId: string;
}

export const evidenceFactSchema = z.object({
  id: z.string().min(1),
  factType: z.string().min(1),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  source: z.enum(EVIDENCE_SOURCES),
  sourceTrust: z.enum(SOURCE_TRUST_LEVELS),
  verified: z.boolean(),
  createdAt: z.string(),
  modelVersion: z.string().optional(),
  policyVersionSeen: z.string().optional(),
  traceId: z.string().min(1),
});

/** Default source trust mapping (FR-1). */
export const DEFAULT_SOURCE_TRUST: Record<EvidenceSource, SourceTrust> = {
  user_chat: 'low',
  form_submission: 'low',
  ocr: 'low',
  uploaded_document: 'medium',
  ehr: 'high',
  clinician_confirmed: 'high',
  verified_guideline: 'high',
  voice_transcript: 'low',
};

/** Known fact types — not exhaustive; new types need no code change. */
export const FACT_TYPES = [
  'symptom',
  'vital_sign',
  'vital_temperature',
  'patient_age_months',
  'lab_value',
  'medication',
  'allergy',
  'condition',
  'document_finding',
  'mental_health',
  'chief_complaint',
  'duration',
  'severity',
  'history',
] as const;
export type FactType = (typeof FACT_TYPES)[number];

// =============================================================================
// Red-Flag Engine (FR-3)
// =============================================================================

export type RedFlagOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  | 'in'
  | 'any_of';

export interface RedFlagCondition {
  factType: string;
  operator: RedFlagOperator;
  value: unknown;
}

export interface RedFlagRule {
  id: string;
  name: string;
  description: string;
  /** ALL conditions must match for the rule to fire (AND semantics). */
  conditions: RedFlagCondition[];
  action: AllowedAction;
  enabled: boolean;
}

export interface RedFlagHit {
  ruleId: string;
  ruleName: string;
  matchedFactIds: string[];
  action: AllowedAction;
  timestamp: string;
}

export interface RedFlagResult {
  triggered: boolean;
  hits: RedFlagHit[];
}

// =============================================================================
// Risk Estimate (FR-4) — the probabilistic "π" the model proposes
// =============================================================================

export interface RiskEstimate {
  pRoutine: number;
  pUrgent: number;
  pCritical: number;
  confidence: number;
  oodScore: number;
  evidenceCoverageScore: number;
  reasonCodes: string[];
  modelVersion: string;
}

export const riskEstimateSchema = z.object({
  pRoutine: z.number().min(0).max(1),
  pUrgent: z.number().min(0).max(1),
  pCritical: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  oodScore: z.number().min(0).max(1),
  evidenceCoverageScore: z.number().min(0).max(1),
  reasonCodes: z.array(z.string()),
  modelVersion: z.string(),
});

// =============================================================================
// Policy Decision (FR-6) — the deterministic engine's output
// =============================================================================

export interface PolicyDecision {
  action: AllowedAction;
  decisionReason: string;
  policyVersion: string;
  ruleIdsApplied: string[];
  requiresHumanReview: boolean;
  requiresSummarySuppression: boolean;
}

export const policyDecisionSchema = z.object({
  action: allowedActionSchema,
  decisionReason: z.string(),
  policyVersion: z.string(),
  ruleIdsApplied: z.array(z.string()),
  requiresHumanReview: z.boolean(),
  requiresSummarySuppression: z.boolean(),
});

// =============================================================================
// Policy Bundle (FR-2) — signing fields frozen NOW so T2 hardens, never edits this file
// =============================================================================

export interface UrgencyThresholds {
  abstentionThreshold: number;
  oodThreshold: number;
  reviewThreshold: number;
  escalateThreshold: number;
  urgentThreshold: number;
  immediateCallbackThreshold: number;
  selfCareConfidenceThreshold: number;
}

export interface PolicyBundleMetadata {
  policyVersion: string;
  checksum: string;
  signedBy: string;
  createdAt: string;
  changeNote: string;
  /** T2: detached signature over the checksum. Optional so T1's DEFAULT_POLICY can omit it. */
  signature?: string;
  signatureAlgorithm?: 'hmac-sha256' | 'ed25519';
}

export interface PolicyBundle {
  metadata: PolicyBundleMetadata;
  redFlagRules: RedFlagRule[];
  urgencyThresholds: UrgencyThresholds;
  allowedActions: AllowedAction[];
  prohibitedOutputPatterns: string[];
}

/** Result of verifying a bundle before adjudication (demo: "checksum ok · signature verified ✓"). */
export interface BundleVerification {
  policyVersion: string;
  checksum: string;
  checksumValid: boolean;
  signatureValid: boolean;
  signedBy: string;
}

// =============================================================================
// Adjudication Trace — the provable, replayable trace (demo beat 1)
//   EvidenceFacts → red-flag rules fired → π → AllowedAction, against a verified bundle.
// =============================================================================

export interface AdjudicationTrace {
  traceId: string;
  createdAt: string;
  engineVersion: string;
  evidence: EvidenceFact[];
  redFlagResult: RedFlagResult;
  riskEstimate: RiskEstimate;
  decision: PolicyDecision;
  bundle: BundleVerification;
  workflowState: WorkflowState;
}

// =============================================================================
// Workflow — forward-only state machine (never downgrades)
// =============================================================================

export const WORKFLOW_STATES = [
  'COLLECTING_EVIDENCE',
  'ADJUDICATING',
  'GUIDANCE_DELIVERED',
  'HUMAN_HANDOFF',
  'CLOSED',
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const WORKFLOW_ORDER: Record<WorkflowState, number> = {
  COLLECTING_EVIDENCE: 0,
  ADJUDICATING: 1,
  GUIDANCE_DELIVERED: 2,
  HUMAN_HANDOFF: 3,
  CLOSED: 4,
};

/** Forward-only: a transition is allowed only if it does not move backward. Pure helper. */
export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return WORKFLOW_ORDER[to] >= WORKFLOW_ORDER[from];
}

// =============================================================================
// Engine function signatures — impls live in engine/*.ts (NotImplemented stubs until T1)
// =============================================================================

export interface AdjudicateInput {
  evidence: EvidenceFact[];
  riskEstimate: RiskEstimate;
  bundle: PolicyBundle;
  /** Defaults to COLLECTING_EVIDENCE → ADJUDICATING. */
  workflowState?: WorkflowState;
}

/** Top-level: evidence + proposed risk + verified bundle → the full provable trace. */
export type AdjudicateFn = (input: AdjudicateInput) => AdjudicationTrace;
