/**
 * Audit READ-side view model (T11). Maps a stored AuditEntry (its JSON columns) into a typed,
 * render-ready step for the audit-trail viewer — including the per-step intervention labels the UI
 * highlights. Pure: no DB, no React. The page component stays thin; this is unit-testable.
 */
import type {
  AdjudicationTrace,
  AllowedAction,
  EvidenceFact,
  PolicyBundle,
  PolicyDecision,
  RedFlagResult,
  RiskEstimate,
} from '@/engine/types';
import { detectIntervention, type InterventionKind } from './producer';
import { verifyAuditEntry } from './verify';

/** The raw row shape as read back from Prisma (Json columns are `unknown` at the boundary). */
export interface StoredAuditEntry {
  id: string;
  seq: number;
  evidenceJson: unknown;
  redFlagJson: unknown;
  riskJson: unknown;
  decisionJson: unknown;
  bundleVersion: string;
  bundleChecksum: string;
  intervention: boolean;
  ruleIdsFired: string[];
}

export interface AuditStepView {
  id: string;
  seq: number;
  evidence: EvidenceFact[];
  redFlagResult: RedFlagResult;
  risk: RiskEstimate | null;
  decision: PolicyDecision | null;
  intervention: boolean;
  interventionKinds: InterventionKind[];
  /** The action the model's risk alone would have produced (for the overruled view). */
  modelProposedAction: AllowedAction | null;
  engineAction: AllowedAction | null;
  ruleIdsFired: string[];
  bundleVersion: string;
  bundleChecksum: string;
  /** Checksum verification result (computed against the supplied bundle, if any). */
  checksumVerified: boolean | null;
}

/**
 * Reconstruct an AdjudicationTrace-ish object from a stored row so we can re-run the pure
 * intervention/verify logic on read. Tolerant of nulls (older/partial rows).
 */
function rebuildTrace(entry: StoredAuditEntry): AdjudicationTrace | null {
  const decision = entry.decisionJson as PolicyDecision | null;
  const risk = entry.riskJson as RiskEstimate | null;
  const redFlagResult = (entry.redFlagJson as RedFlagResult | null) ?? { triggered: false, hits: [] };
  const evidence = (entry.evidenceJson as EvidenceFact[] | null) ?? [];
  if (!decision || !risk) return null;
  return {
    traceId: evidence[0]?.traceId ?? 'stored',
    createdAt: '',
    engineVersion: '',
    evidence,
    redFlagResult,
    riskEstimate: risk,
    decision,
    bundle: {
      policyVersion: entry.bundleVersion,
      checksum: entry.bundleChecksum,
      checksumValid: true,
      signatureValid: true,
      signedBy: '',
    },
    workflowState: decision.action === 'BLOCK_AND_HUMAN_HANDOFF' ? 'HUMAN_HANDOFF' : 'GUIDANCE_DELIVERED',
  };
}

/** Map a stored entry → a render-ready step. `bundle` (optional) enables checksum verify + overruled. */
export function toStepView(entry: StoredAuditEntry, bundle?: PolicyBundle): AuditStepView {
  const trace = rebuildTrace(entry);
  const evidence = (entry.evidenceJson as EvidenceFact[] | null) ?? [];
  const redFlagResult = (entry.redFlagJson as RedFlagResult | null) ?? { triggered: false, hits: [] };
  const risk = (entry.riskJson as RiskEstimate | null) ?? null;
  const decision = (entry.decisionJson as PolicyDecision | null) ?? null;

  const intervention = trace ? detectIntervention(trace, bundle) : null;
  const checksumVerified = bundle ? verifyAuditEntry(entry, bundle).verified : null;

  return {
    id: entry.id,
    seq: entry.seq,
    evidence,
    redFlagResult,
    risk,
    decision,
    // trust the stored flag, but enrich kinds from the recomputed result when available
    intervention: entry.intervention,
    interventionKinds: intervention?.kinds ?? [],
    modelProposedAction: intervention?.modelProposedAction ?? null,
    engineAction: intervention?.engineAction ?? decision?.action ?? null,
    ruleIdsFired: entry.ruleIdsFired ?? [],
    bundleVersion: entry.bundleVersion,
    bundleChecksum: entry.bundleChecksum,
    checksumVerified,
  };
}

export interface CallTrailView {
  steps: AuditStepView[];
  interventionCount: number;
  /** True iff every step with a bundle verified against the checksum. Null if no bundle supplied. */
  allVerified: boolean | null;
}

export function toCallTrailView(entries: StoredAuditEntry[], bundle?: PolicyBundle): CallTrailView {
  const steps = entries
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((e) => toStepView(e, bundle));
  const interventionCount = steps.filter((s) => s.intervention).length;
  const verifiable = steps.map((s) => s.checksumVerified).filter((v): v is boolean => v !== null);
  const allVerified = verifiable.length > 0 ? verifiable.every(Boolean) : null;
  return { steps, interventionCount, allVerified };
}
