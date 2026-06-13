/**
 * Layer 3 — Deterministic policy adjudication (FR-6). Maps {red-flag result, risk estimate,
 * bundle} → one AllowedAction. Properties: deterministic, fail-closed (uncertainty escalates,
 * never downgrades), red flags dominate. Pure function — no AI, no DB. Ported from VA-5 in T1.
 */
import type { PolicyBundle, PolicyDecision, RedFlagResult, RiskEstimate } from './types';
import { notImplemented } from './_stub';

export function decide(
  _redFlagResult: RedFlagResult,
  _riskEstimate: RiskEstimate,
  _bundle: PolicyBundle,
): PolicyDecision {
  return notImplemented('engine/policy.decide');
}
