import type { AllowedAction } from '@/engine/types';
import { ACTION_SEVERITY } from '@/engine/types';

/** Actions at/above same-day review count as an escalation. */
export function isEscalation(action: AllowedAction): boolean {
  return ACTION_SEVERITY[action] >= ACTION_SEVERITY['SAME_DAY_REVIEW'];
}

/** Reassurance = the lowest-acuity disposition. A critical case getting this is the worst error. */
export function isReassurance(action: AllowedAction): boolean {
  return action === 'SELF_CARE_INFO_ONLY';
}

export interface CaseOutcome {
  id: string;
  critical: boolean;
  action: AllowedAction;
}

export interface EvalScores {
  total: number;
  critical: number;
  /** sensitivity = critical cases that escalated / critical cases. */
  sensitivity: number;
  /** false-reassurance = critical cases reassured / critical cases (lower is better; target 0). */
  falseReassurance: number;
}

export function score(outcomes: CaseOutcome[]): EvalScores {
  const crit = outcomes.filter((o) => o.critical);
  const escalated = crit.filter((o) => isEscalation(o.action)).length;
  const reassured = crit.filter((o) => isReassurance(o.action)).length;
  return {
    total: outcomes.length,
    critical: crit.length,
    sensitivity: crit.length ? escalated / crit.length : 1,
    falseReassurance: crit.length ? reassured / crit.length : 0,
  };
}
