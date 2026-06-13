/**
 * Inference-check — the anti-prompt-injection / authority-spoofing guard. Policy authority
 * comes ONLY from the signed bundle, never from model or user text. Rejects outputs matching
 * the bundle's prohibitedOutputPatterns and any attempt to assert a disposition. Ported in T1.
 */
import type { PolicyBundle } from './types';
import { notImplemented } from './_stub';

export interface InferenceCheckResult {
  passed: boolean;
  flags: string[];
}

export function runInferenceCheck(_modelText: string, _bundle: PolicyBundle): InferenceCheckResult {
  return notImplemented('engine/inference-check.runInferenceCheck');
}
