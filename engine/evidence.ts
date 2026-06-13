/**
 * Layer 1 — Evidence (FR-1). Normalizes raw inputs into typed EvidenceFacts with a source-trust
 * level, and REJECTS AI prose at the door (the model-blind discipline: only structured facts enter
 * the engine). Ported from VA-5 (pulse-mgmt-crm/lib/triage/evidence-extractor.ts). Pure — no AI, no DB.
 */
import { randomUUID } from 'node:crypto';
import type { EvidenceFact, EvidenceSource, SourceTrust } from './types';
import { DEFAULT_SOURCE_TRUST, evidenceFactSchema } from './types';

export interface RawEvidenceInput {
  source: EvidenceSource;
  factType: string;
  value: unknown;
  confidence?: number;
  sourceTrust?: SourceTrust;
  verified?: boolean;
  modelVersion?: string;
}

export interface ExtractionOptions {
  traceId: string;
  policyVersion?: string;
  sourceTrustOverrides?: Partial<Record<EvidenceSource, SourceTrust>>;
}

export interface ExtractionResult {
  facts: EvidenceFact[];
  droppedCount: number;
}

/** Default per-source confidence when the input does not supply one. */
const DEFAULT_CONFIDENCE: Record<EvidenceSource, number> = {
  user_chat: 0.6,
  form_submission: 0.7,
  ocr: 0.65,
  uploaded_document: 0.7,
  ehr: 0.95,
  clinician_confirmed: 1.0,
  verified_guideline: 1.0,
  voice_transcript: 0.5,
};

const PROSE_PATTERNS: RegExp[] = [
  /^(based on|according to|it appears|the patient (likely|may|might|seems))/i,
  /^(my assessment|in my (clinical |medical )?opinion)/i,
  /^(diagnosis|treatment plan|recommended course)/i,
  /\b(I recommend|you should take|increase.*dose|decrease.*dose)\b/i,
];

/** The memory-safety boundary: long, model-prose-shaped values never become evidence. */
export function isAIGeneratedProse(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 50) return false;
  return PROSE_PATTERNS.some((re) => re.test(value));
}

export function getSourceTrust(
  source: EvidenceSource,
  overrides?: Partial<Record<EvidenceSource, SourceTrust>>,
): SourceTrust {
  return overrides?.[source] ?? DEFAULT_SOURCE_TRUST[source];
}

export function extractSingleFact(
  input: RawEvidenceInput,
  options: ExtractionOptions,
): EvidenceFact | null {
  if (isAIGeneratedProse(input.value)) return null;

  const sourceTrust = input.sourceTrust ?? getSourceTrust(input.source, options.sourceTrustOverrides);
  const rawConfidence = input.confidence ?? DEFAULT_CONFIDENCE[input.source];
  const confidence = Math.min(1, Math.max(0, rawConfidence));

  const fact: EvidenceFact = {
    id: randomUUID(),
    factType: input.factType,
    value: input.value,
    confidence,
    source: input.source,
    sourceTrust,
    verified: input.verified ?? false,
    createdAt: new Date().toISOString(),
    modelVersion: input.modelVersion,
    policyVersionSeen: options.policyVersion,
    traceId: options.traceId,
  };

  const parsed = evidenceFactSchema.safeParse(fact);
  return parsed.success ? fact : null;
}

export function extractEvidence(
  inputs: RawEvidenceInput[],
  options: ExtractionOptions,
): ExtractionResult {
  const facts: EvidenceFact[] = [];
  let droppedCount = 0;
  for (const input of inputs) {
    const fact = extractSingleFact(input, options);
    if (fact) facts.push(fact);
    else droppedCount += 1;
  }
  return { facts, droppedCount };
}
