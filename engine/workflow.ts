/**
 * Forward-only workflow (never downgrades). `canTransition` (pure helper in types.ts) is the law;
 * `advance` enforces it — moving to a lower-rank state throws.
 */
import type { WorkflowState } from './types';
import { canTransition } from './types';

export { canTransition };

export function advance(from: WorkflowState, to: WorkflowState): WorkflowState {
  if (!canTransition(from, to)) {
    throw new Error(`forward-only workflow: cannot move ${from} -> ${to}`);
  }
  return to;
}
