/**
 * Forward-only workflow (never downgrades). `canTransition` is a pure helper in types.ts and
 * is live now; `advance` (which records state + guards backward moves) is ported in T1.
 */
import type { WorkflowState } from './types';
import { canTransition } from './types';
import { notImplemented } from './_stub';

export { canTransition };

export function advance(_from: WorkflowState, _to: WorkflowState): WorkflowState {
  return notImplemented('engine/workflow.advance');
}
