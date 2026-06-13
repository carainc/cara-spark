/**
 * Layer 1 — Evidence (FR-1). Normalizes raw inputs (chat, form, OCR, EHR, voice) into typed
 * EvidenceFacts with a source-trust level. Pure; no AI calls in the deterministic path
 * (the model PROPOSES facts; this layer types + trusts them). Ported from VA-5 in T1.
 */
import type { EvidenceFact, EvidenceSource } from './types';
import { DEFAULT_SOURCE_TRUST } from './types';
import { notImplemented } from './_stub';

export interface RawEvidenceInput {
  factType: string;
  value: unknown;
  source: EvidenceSource;
  confidence?: number;
  verified?: boolean;
}

/** Map a source to its default trust level (pure data lookup — safe to use now). */
export function getSourceTrust(source: EvidenceSource) {
  return DEFAULT_SOURCE_TRUST[source];
}

export function extractEvidence(_inputs: RawEvidenceInput[], _traceId: string): EvidenceFact[] {
  return notImplemented('engine/evidence.extractEvidence');
}
