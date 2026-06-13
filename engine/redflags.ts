/**
 * Layer 2 — Red-flag rules (FR-3). Deterministic pattern match over EvidenceFacts. ALL conditions
 * of a rule must match (AND); ALL matching rules fire. Red-flag DOMINANCE is enforced in policy.ts.
 * Ported from VA-5 (pulse-mgmt-crm/lib/triage/red-flag-engine.ts). Pure — no AI, no DB.
 */
import type {
  EvidenceFact,
  RedFlagCondition,
  RedFlagHit,
  RedFlagResult,
  RedFlagRule,
} from './types';

function numericCompare(op: 'gt' | 'gte' | 'lt' | 'lte', a: number, b: number): boolean {
  switch (op) {
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
  }
}

export function evaluateRedFlagCondition(
  condition: RedFlagCondition,
  evidence: EvidenceFact[],
): { matched: boolean; matchedFactIds: string[] } {
  const { factType, operator, value } = condition;

  // `any_of` matches facts whose factType is one of value[]; all others filter by factType.
  const relevant =
    operator === 'any_of'
      ? evidence.filter((f) => Array.isArray(value) && value.includes(f.factType))
      : evidence.filter((f) => f.factType === factType);

  const ids = (facts: EvidenceFact[]) => facts.map((f) => f.id);

  switch (operator) {
    case 'exists':
      if (value === false) return { matched: relevant.length === 0, matchedFactIds: [] };
      return { matched: relevant.length > 0, matchedFactIds: ids(relevant) };
    case 'any_of':
      return { matched: relevant.length > 0, matchedFactIds: ids(relevant) };
    case 'equals': {
      const m = relevant.filter((f) => f.value === value);
      return { matched: m.length > 0, matchedFactIds: ids(m) };
    }
    case 'not_equals': {
      const m = relevant.filter((f) => f.value !== value);
      return { matched: m.length > 0, matchedFactIds: ids(m) };
    }
    case 'contains': {
      const m = relevant.filter(
        (f) =>
          typeof f.value === 'string' &&
          typeof value === 'string' &&
          f.value.toLowerCase().includes(value.toLowerCase()),
      );
      return { matched: m.length > 0, matchedFactIds: ids(m) };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const m = relevant.filter(
        (f) => typeof f.value === 'number' && typeof value === 'number' && numericCompare(operator, f.value, value),
      );
      return { matched: m.length > 0, matchedFactIds: ids(m) };
    }
    case 'in': {
      const arr = Array.isArray(value) ? value : [];
      const m = relevant.filter((f) => arr.includes(f.value));
      return { matched: m.length > 0, matchedFactIds: ids(m) };
    }
    default:
      return { matched: false, matchedFactIds: [] };
  }
}

export function evaluateRedFlags(evidence: EvidenceFact[], rules: RedFlagRule[]): RedFlagResult {
  const hits: RedFlagHit[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.conditions.length === 0) continue;
    const ids: string[] = [];
    let allMatch = true;
    for (const condition of rule.conditions) {
      const result = evaluateRedFlagCondition(condition, evidence);
      if (!result.matched) {
        allMatch = false;
        break;
      }
      ids.push(...result.matchedFactIds);
    }
    if (allMatch) {
      hits.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matchedFactIds: [...new Set(ids)],
        action: rule.action,
        timestamp: new Date().toISOString(),
      });
    }
  }
  return { triggered: hits.length > 0, hits };
}

/**
 * 15 default red-flag rules (11 base + 4 pediatric), ported from VA-5. `infant-fever-floor` is the
 * demo's golden path: infant ≤3mo + temp ≥100.4°F → emergency. Suppress this and the demo loses beat 1.
 */
export const DEFAULT_RED_FLAG_RULES: RedFlagRule[] = [
  {
    id: 'rf-001',
    name: 'Chest pain with shortness of breath',
    description: 'Possible acute coronary / pulmonary emergency.',
    conditions: [
      { factType: 'symptom', operator: 'contains', value: 'chest pain' },
      { factType: 'symptom', operator: 'contains', value: 'shortness of breath' },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-002',
    name: 'Stroke-like symptoms',
    description: 'FAST — facial droop, slurred speech, unilateral weakness, sudden numbness.',
    conditions: [
      { factType: 'symptom', operator: 'any_of', value: ['facial_droop', 'slurred_speech', 'unilateral_weakness', 'sudden_numbness'] },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-003',
    name: 'Anaphylaxis',
    description: 'Airway / allergic emergency.',
    conditions: [
      { factType: 'symptom', operator: 'any_of', value: ['anaphylaxis', 'throat_swelling', 'difficulty_breathing_allergic'] },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-004',
    name: 'Suicidal ideation or intent',
    description: 'Mental-health emergency — immediate crisis response.',
    conditions: [
      { factType: 'mental_health', operator: 'any_of', value: ['suicidal_ideation', 'suicidal_intent', 'self_harm_intent'] },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-005',
    name: 'Severe bleeding',
    description: 'Uncontrolled hemorrhage.',
    conditions: [{ factType: 'symptom', operator: 'contains', value: 'severe bleeding' }],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-006',
    name: 'Altered mental status',
    description: 'Confusion, loss of consciousness, unresponsiveness.',
    conditions: [
      { factType: 'symptom', operator: 'any_of', value: ['altered_mental_status', 'confusion', 'loss_of_consciousness', 'unresponsive'] },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-007',
    name: 'Critical potassium',
    description: 'Hyperkalemia — arrhythmia risk.',
    conditions: [{ factType: 'lab_potassium', operator: 'gt', value: 6.5 }],
    action: 'IMMEDIATE_CLINIC_CALLBACK',
    enabled: true,
  },
  {
    id: 'rf-008',
    name: 'Critical sodium',
    description: 'Severe hyponatremia.',
    conditions: [{ factType: 'lab_sodium', operator: 'lt', value: 120 }],
    action: 'IMMEDIATE_CLINIC_CALLBACK',
    enabled: true,
  },
  {
    id: 'rf-009',
    name: 'Critical glucose',
    description: 'Severe hyperglycemia.',
    conditions: [{ factType: 'lab_glucose', operator: 'gt', value: 500 }],
    action: 'IMMEDIATE_CLINIC_CALLBACK',
    enabled: true,
  },
  {
    id: 'rf-010',
    name: 'High fever + immunocompromised',
    description: 'Febrile immunocompromised patient.',
    conditions: [
      { factType: 'vital_temperature', operator: 'gt', value: 101.3 },
      { factType: 'condition', operator: 'equals', value: 'immunocompromised' },
    ],
    action: 'IMMEDIATE_CLINIC_CALLBACK',
    enabled: true,
  },
  {
    id: 'rf-011',
    name: 'Acute vision loss',
    description: 'Sudden vision loss / blindness.',
    conditions: [{ factType: 'symptom', operator: 'any_of', value: ['acute_vision_loss', 'sudden_blindness'] }],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'infant-fever-floor',
    name: 'Fever in infant 3 months or younger',
    description: 'Temp ≥100.4°F in an infant ≤3 months — immediate evaluation.',
    conditions: [
      { factType: 'patient_age_months', operator: 'lte', value: 3 },
      { factType: 'vital_temperature', operator: 'gte', value: 100.4 },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-013',
    name: 'Severe pediatric breathing distress',
    description: 'Cyanosis, blue lips, gasping, cannot speak or cry.',
    conditions: [
      { factType: 'symptom', operator: 'any_of', value: ['color_blue_gray_mottled', 'blue_lips', 'gasping', 'cannot_speak_or_cry'] },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-014',
    name: 'Non-blanching rash with fever',
    description: 'Possible meningococcemia.',
    conditions: [
      { factType: 'symptom', operator: 'any_of', value: ['rash_non_blanching', 'petechial_rash'] },
      { factType: 'vital_temperature', operator: 'gte', value: 100.4 },
    ],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
  {
    id: 'rf-015',
    name: 'Unarousable or unresponsive child',
    description: 'Hard to wake / unresponsive.',
    conditions: [{ factType: 'symptom', operator: 'any_of', value: ['hard_to_wake', 'unresponsive'] }],
    action: 'ED_OR_911_GUIDANCE',
    enabled: true,
  },
];
