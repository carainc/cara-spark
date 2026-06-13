/**
 * Layer 3 — Risk estimate (FR-4). The DETERMINISTIC baseline: evidence → (pRoutine, pUrgent,
 * pCritical) + confidence / OOD / coverage. In production the model's PROPOSED probabilities are
 * coerced into this same (schema-validated) RiskEstimate shape — the engine never trusts free model
 * output, only a valid RiskEstimate. Ported from VA-5 (risk-estimator.ts). Pure — no AI, no DB.
 */
import type { EvidenceFact, RiskEstimate, SourceTrust } from './types';
import { FACT_TYPES } from './types';

export interface RiskEstimatorConfig {
  modelVersion: string;
  minEvidenceCount?: number;
  minFactTypes?: number;
}

const SOURCE_TRUST_WEIGHT: Record<SourceTrust, number> = { low: 0.5, medium: 0.75, high: 1.0 };

const CRITICAL_SIGNALS = [
  'loss of consciousness',
  'stroke',
  'seizure',
  'anaphylaxis',
  'cardiac arrest',
  'severe bleeding',
  'suicidal',
  'self-harm',
  'unresponsive',
  'not breathing',
];
const URGENT_SIGNALS = [
  'chest pain',
  'shortness of breath',
  'severe pain',
  'high fever',
  'rapid heart rate',
  'difficulty breathing',
  'severe headache',
  'uncontrolled bleeding',
  'allergic reaction',
];

const KNOWN_FACT_TYPES = FACT_TYPES as readonly string[];

function lowerStr(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function computeEvidenceCoverage(
  evidence: EvidenceFact[],
  minEvidenceCount = 3,
  minFactTypes = 2,
): number {
  if (evidence.length === 0) return 0;
  const volume = Math.min(1, evidence.length / minEvidenceCount);
  const distinct = new Set(evidence.map((f) => f.factType)).size;
  const diversity = Math.min(1, distinct / minFactTypes);
  const verification = evidence.filter((f) => f.verified).length / evidence.length;
  return volume * 0.4 + diversity * 0.4 + verification * 0.2;
}

export function computeConfidence(evidence: EvidenceFact[]): number {
  if (evidence.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (const f of evidence) {
    const w = SOURCE_TRUST_WEIGHT[f.sourceTrust];
    num += f.confidence * w;
    den += w;
  }
  return den === 0 ? 0 : num / den;
}

export function computeOodScore(evidence: EvidenceFact[]): number {
  if (evidence.length === 0) return 1;
  const unknown = evidence.filter((f) => !KNOWN_FACT_TYPES.includes(f.factType)).length;
  return unknown / evidence.length;
}

export function computeProbabilities(evidence: EvidenceFact[]): {
  pRoutine: number;
  pUrgent: number;
  pCritical: number;
  reasonCodes: string[];
} {
  let criticalScore = 0;
  let urgentScore = 0;
  const reasonCodes: string[] = [];

  for (const f of evidence) {
    const w = SOURCE_TRUST_WEIGHT[f.sourceTrust];
    const s = lowerStr(f.value);
    for (const sig of CRITICAL_SIGNALS) {
      if (s.includes(sig)) {
        criticalScore += w;
        reasonCodes.push(`critical_signal:${sig}`);
      }
    }
    for (const sig of URGENT_SIGNALS) {
      if (s.includes(sig)) {
        urgentScore += w;
        reasonCodes.push(`urgent_signal:${sig}`);
      }
    }
    if (f.factType === 'severity' && f.sourceTrust === 'high') {
      if (s === 'critical' || s === 'severe') criticalScore += 1;
      else if (s === 'moderate') urgentScore += 0.5;
    }
  }

  if (criticalScore === 0 && urgentScore === 0) {
    return { pRoutine: 0.85, pUrgent: 0.1, pCritical: 0.05, reasonCodes: ['routine_presentation'] };
  }

  const total = Math.max(1, urgentScore + criticalScore);
  let pCritical = Math.min(1, criticalScore / total);
  let pUrgent = Math.min(1, urgentScore / total);
  if (pCritical + pUrgent > 1) {
    const sum = pCritical + pUrgent;
    pCritical /= sum;
    pUrgent /= sum;
  }
  const pRoutine = Math.max(0, 1 - pUrgent - pCritical);
  return { pRoutine, pUrgent, pCritical, reasonCodes: [...new Set(reasonCodes)] };
}

export function estimateRisk(evidence: EvidenceFact[], config: RiskEstimatorConfig): RiskEstimate {
  if (evidence.length === 0) {
    return {
      pRoutine: 0,
      pUrgent: 0,
      pCritical: 0,
      confidence: 0,
      oodScore: 1,
      evidenceCoverageScore: 0,
      reasonCodes: ['no_evidence'],
      modelVersion: config.modelVersion,
    };
  }
  const { pRoutine, pUrgent, pCritical, reasonCodes } = computeProbabilities(evidence);
  return {
    pRoutine,
    pUrgent,
    pCritical,
    confidence: computeConfidence(evidence),
    oodScore: computeOodScore(evidence),
    evidenceCoverageScore: computeEvidenceCoverage(evidence, config.minEvidenceCount, config.minFactTypes),
    reasonCodes,
    modelVersion: config.modelVersion,
  };
}
