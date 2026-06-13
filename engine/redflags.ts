/**
 * Layer 2 — Red-flag rules (FR-3). Deterministic pattern match over EvidenceFacts.
 * Red flags DOMINATE: a fired rule always overrides the probabilistic estimate. Ported in T1.
 */
import type { EvidenceFact, RedFlagCondition, RedFlagResult, RedFlagRule } from './types';
import { notImplemented } from './_stub';

export function evaluateRedFlagCondition(_fact: EvidenceFact, _cond: RedFlagCondition): boolean {
  return notImplemented('engine/redflags.evaluateRedFlagCondition');
}

export function evaluateRedFlags(_facts: EvidenceFact[], _rules: RedFlagRule[]): RedFlagResult {
  return notImplemented('engine/redflags.evaluateRedFlags');
}
