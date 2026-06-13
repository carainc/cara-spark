/**
 * Engine public API — the deterministic triage core. The model PROPOSES (evidence + risk);
 * the engine DECIDES. `adjudicate` composes evidence → red-flag eval → policy decision against
 * a VERIFIED bundle and returns the full provable AdjudicationTrace. NotImplemented until T1.
 */
import type { AdjudicateInput, AdjudicationTrace } from './types';
import { notImplemented } from './_stub';

export const ENGINE_VERSION = '0.1.0-stub';

export function adjudicate(_input: AdjudicateInput): AdjudicationTrace {
  return notImplemented('engine.adjudicate');
}

// Re-exports — lanes import the whole engine surface from '@/engine'.
export * from './types';
export * from './evidence';
export * from './redflags';
export * from './policy';
export * from './inference-check';
export * from './workflow';
export * from './policy-bundle';
