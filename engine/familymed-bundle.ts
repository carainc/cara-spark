/**
 * familymed-v1 — Dr. Michael Hobbs MD's family-medicine triage protocol, encoded as a SIGNED policy
 * bundle (PART B of tk-0025). This is the ENGINE'S HALF of the thesis: the deterministic gates that
 * DECIDE the disposition. The conversational scaffolding (Phases 1–3, the question framings) lives in
 * the agent PERSONA (lib/agent/extract via db/seed) — never here, and never in the model's hands.
 *
 * Source: docs/protocols/triage-familymed-v1.md (Schmitt-Thompson adult telephone protocols, adapted).
 * Scope: adolescents/adults/older adults + pregnancy/postpartum (the pediatric body lives in
 * DEFAULT_POLICY's infant rules; this bundle ADDS adult/OB gates, it does not replace them).
 *
 * It does NOT modify DEFAULT_POLICY or engine/types.ts (both FROZEN). It is a NEW bundle, created via
 * the existing createPolicyBundle/signBundle path and registered (engine/index.ts) so it surfaces in
 * GET /api/bundles + the console Policies tab alongside the default.
 *
 * ── Disposition mapping (protocol level → finite AllowedAction) ──
 *   home_care    → SELF_CARE_INFO_ONLY        (no gate fires → engine risk path)
 *   needs_review → ROUTINE_REVIEW             (no gate fires → engine risk path)
 *                  SAME_DAY_REVIEW            (where the protocol says urgent / same-day)
 *   er_drive     → ED_OR_911_GUIDANCE
 *   er_911       → ED_OR_911_GUIDANCE         (the canned guidance covers "call 911 or go to an ED")
 *
 * ── FAIL-CLOSED ──
 *   Every rule ESCALATES (it fires UP to a more-severe action; a non-firing rule is silent). Where a
 *   danger pattern is ambiguous we encode it at the HIGHER tier. Red-flag dominance (policy.ts) then
 *   guarantees the most-severe fired rule wins, so adding these gates can only ADD escalation — it
 *   can never introduce false reassurance. SELF_CARE/ROUTINE come from the engine's risk path when NO
 *   gate fires, exactly as for the default bundle.
 *
 * ── Matching model (IMPORTANT) ──
 *   Conditions are AND within a rule; ALL matching rules fire (redflags.ts). The `contains` operator
 *   is a case-insensitive SUBSTRING test on a fact's string VALUE — it matches both coded values
 *   (e.g. `unilateral_weakness`) and natural phrasing (e.g. "chest pressure radiating to my arm").
 *   NOTE: `any_of` in this engine matches by fact TYPE presence, not value, so it is the WRONG tool
 *   for "symptom is one of these phrases" — every gate below uses `contains` on the VALUE instead.
 *   To survive the model's phrasing/factType drift, each danger phrase is checked across the three
 *   free-text factTypes the model plausibly emits (symptom / chief_complaint / condition).
 */
import type { PolicyBundle, RedFlagRule } from './types';
import { ALLOWED_ACTIONS } from './types';
import {
  createPolicyBundle,
  signBundle,
  DEFAULT_URGENCY_THRESHOLDS,
  DEFAULT_PROHIBITED_PATTERNS,
} from './policy-bundle';

/** The DB version string the seed + selector + audit resolver key on. */
export const FAMILYMED_BUNDLE_VERSION = 'familymed-v1';

// er_drive AND er_911 both map here; the canned guidance covers "call 911 or go to the nearest ED".
// (needs_review → ROUTINE_REVIEW and home_care → SELF_CARE_INFO_ONLY are the engine's NON-firing risk
//  path; SAME_DAY_REVIEW is reserved for an urgent/same-day gate — none in this ED-dominant set.)
const ED = 'ED_OR_911_GUIDANCE' as const;

/** Free-text factTypes the model plausibly emits for a symptom/condition phrase. */
const TEXT_FACTS = ['symptom', 'chief_complaint', 'condition'] as const;

/**
 * A gate: fires when ANY of `phrases` is a substring of ANY free-text fact's value. Each (phrase ×
 * factType) becomes its own single-condition `contains` rule sharing the gate's name/action — so the
 * model's choice of factType (symptom vs chief_complaint vs condition) and exact wording don't matter
 * (recall-first; ambiguity escalates UP). Phrases are lowercase (contains is case-insensitive).
 */
function gate(
  id: string,
  name: string,
  description: string,
  phrases: string[],
  action: RedFlagRule['action'] = ED,
): RedFlagRule[] {
  return phrases.flatMap((phrase, i) =>
    TEXT_FACTS.map<RedFlagRule>((factType) => ({
      id: `${id}-${factType}-${i}`,
      name,
      description,
      conditions: [{ factType, operator: 'contains', value: phrase }],
      action,
      enabled: true,
    })),
  );
}

/**
 * The familymed-v1 red-flag rules. Tier-1 Core Gates + the highest-value Tier-2 gates. Authored to
 * ESCALATE only; ambiguity resolves UP. Each gate matches a danger phrase across the free-text facts.
 */
export const FAMILYMED_RED_FLAG_RULES: RedFlagRule[] = [
  // ── Tier 1 — Chest pain / ACS and dangerous mimics (dissection, PE) (→ ED) ──
  ...gate(
    'fm-acs',
    'Chest pain — ACS / dangerous chest pain',
    'Chest pressure/tightness, cardiac chest pain, dissection ("tearing"/"ripping" to the back), or PE-pattern pleuritic chest pain. Atypical presentations (women, older adults, diabetes) included; ambiguity escalates.',
    [
      'chest pain',
      'chest pressure',
      'chest tightness',
      'chest squeezing',
      'crushing chest',
      'pressure in chest',
      'tearing chest',
      'ripping chest',
      'angina',
      'acs',
      'heart attack',
    ],
  ),

  // ── Tier 1 — Stroke / BE-FAST, including resolved TIA (→ ED) ──
  ...gate(
    'fm-stroke',
    'Stroke signs (BE-FAST) — incl. resolved TIA',
    'Sudden focal deficit: facial droop, one-sided arm/leg weakness or numbness, slurred/aphasic speech, sudden vision loss/double vision, sudden severe imbalance. Symptoms that already RESOLVED (TIA) still escalate.',
    [
      'stroke',
      'facial_droop',
      'facial droop',
      'face drooping',
      'unilateral_weakness',
      'one-sided weakness',
      'one sided weakness',
      'one side weak',
      'slurred_speech',
      'slurred speech',
      'trouble speaking',
      'aphasia',
      'arm_drift',
      'arm drift',
      'sudden_numbness',
      'sudden numbness',
      'double_vision',
      'double vision',
      'sudden_vision_loss',
      'sudden imbalance',
      'tia',
      'mini stroke',
    ],
  ),

  // ── Tier 1 — Severe difficulty breathing (→ ED) ──
  ...gate(
    'fm-dyspnea',
    'Severe difficulty breathing',
    "Can't speak more than a few words, blue/gray lips or fingertips, gasping, stridor, or exhaustion — severe respiratory distress.",
    [
      'severe_dyspnea',
      'severe shortness of breath',
      'cannot_speak_full_sentence',
      "can't breathe",
      'cannot breathe',
      'struggling to breathe',
      'gasping',
      'stridor',
      'respiratory_distress',
      'blue_lips',
      'blue lips',
      'cyanosis',
      'color_blue_gray_mottled',
      'turning blue',
    ],
  ),

  // ── Tier 1 — Anaphylaxis / severe allergic reaction (→ ED) ──
  ...gate(
    'fm-anaphylaxis',
    'Anaphylaxis / severe allergic reaction',
    'Swelling of lips/tongue/throat/face, trouble breathing or swallowing, throat tightness/voice change, or hives + vomiting/faintness after an exposure; or epinephrine used.',
    [
      'anaphylaxis',
      'throat_swelling',
      'throat swelling',
      'throat tightness',
      'throat_tightness',
      'throat closing',
      'tongue swelling',
      'tongue_swelling',
      'lip swelling',
      'difficulty_swallowing',
      'trouble swallowing',
      'difficulty_breathing_allergic',
      'epinephrine_used',
      'used epipen',
      'used my epipen',
    ],
  ),

  // ── Tier 1 — Possible sepsis / serious infection (→ ED) ──
  ...gate(
    'fm-sepsis',
    'Possible sepsis / serious infection',
    'Suspected infection PLUS a sepsis warning sign: new confusion, rigors, little/no urine all day, severe breathlessness, mottled/clammy skin, overwhelming sense of being very unwell, or a temperature extreme. Lower threshold in older / immunocompromised.',
    ['sepsis', 'septic', 'rigors', 'mottled_skin', 'mottled skin', 'no_urine_all_day', 'feels_like_dying'],
  ),

  // ── Tier 1 — New confusion / altered mental status / delirium (→ ED) ──
  ...gate(
    'fm-ams',
    'New confusion / altered mental status (delirium)',
    'New confusion vs baseline, hard to rouse, disoriented, not making sense, or loss of consciousness. In older / infected patients new confusion may be the only sign.',
    [
      'altered_mental_status',
      'altered mental status',
      'new_confusion',
      'new confusion',
      'confusion',
      'delirium',
      'disoriented',
      'not making sense',
      'loss_of_consciousness',
      'loss of consciousness',
      'passed out',
      'unresponsive',
      'hard_to_rouse',
      'hard to wake',
      'hard_to_wake',
    ],
  ),

  // ── Tier 1 — Signs of shock / poor perfusion (→ ED) ──
  ...gate(
    'fm-shock',
    'Signs of shock / poor perfusion',
    'Pale/gray/blue/mottled skin, cold & clammy, near-fainting on standing, fast weak pulse, very low urine output.',
    ['shock', 'poor_perfusion', 'cold_clammy', 'cold and clammy', 'pale and gray', 'near_fainting', 'near fainting'],
  ),

  // ── Tier 1 — Significant / GI bleeding (→ ED) ──
  ...gate(
    'fm-bleed',
    'Significant bleeding (incl. GI bleed)',
    "Vomiting blood / coffee-ground emesis, black tarry or maroon stool, large-volume or won't-stop bleeding, or bleeding + shock. Lower threshold on anticoagulants.",
    [
      'severe_bleeding',
      'severe bleeding',
      'vomiting_blood',
      'vomiting blood',
      'bloody vomit',
      'hematemesis',
      'coffee_ground',
      'coffee ground',
      'coffee-ground',
      'black_tarry_stool',
      'black tarry stool',
      'tarry stool',
      'melena',
      'maroon stool',
      'uncontrolled_bleeding',
      "won't stop bleeding",
      'wont stop bleeding',
    ],
  ),

  // ── Tier 1 — Severe / dangerous-pattern headache, incl. thunderclap (→ ED) ──
  ...gate(
    'fm-headache',
    'Dangerous-pattern headache (incl. thunderclap)',
    'Thunderclap (max intensity within seconds → brain bleed), headache + stiff neck + fever (meningitis), or headache + focal deficit/confusion/seizure.',
    [
      'thunderclap',
      'thunderclap_headache',
      'worst headache',
      'worst_headache_of_life',
      'sudden severe headache',
      'headache_with_stiff_neck',
      'stiff neck',
    ],
  ),

  // ── Tier 1 — Seizure (→ ED) ──
  ...gate(
    'fm-seizure',
    'Seizure',
    'Active seizure >5 min, repeated seizures without recovery, declining responsiveness, first-time seizure, or seizure in pregnancy (eclampsia).',
    ['seizure', 'status_epilepticus', 'convulsion', 'convulsions', 'having a fit', 'fitting'],
  ),

  // ── Tier 1 — Poisoning / overdose, accidental or intentional (→ ED) ──
  ...gate(
    'fm-poisoning',
    'Possible poisoning / overdose',
    'High-risk substance (opioids, unknown pills/chemicals, mixed/large ingestion), any concerning symptom, or any intentional ingestion. Low-risk asymptomatic accidental exposure is Poison Control first; ambiguity escalates.',
    ['overdose', 'poisoning', 'opioid_overdose', 'took too many pills', 'took_too_many_pills', 'intentional_ingestion', 'swallowed bleach', 'ingested'],
  ),

  // ── Tier 1 — Mental-health crisis (suicide / self-harm / harm to others) (→ ED) ──
  // The model emits the crisis as the dedicated `mental_health` factType (value = a code/phrase), so
  // we `contains`-match the VALUE on `mental_health` AND on the free-text facts. (`any_of` would test
  // factType PRESENCE, not the value — the wrong tool here.) Ambiguity escalates.
  ...['mental_health', ...TEXT_FACTS].flatMap((factType) =>
    [
      'suicidal',
      'suicide',
      'suicidal_ideation',
      'suicidal_intent',
      'suicidal_plan',
      'kill myself',
      'end my life',
      'self_harm',
      'self-harm',
      'recent_self_harm',
      'harm_to_others',
      'hurt someone',
      'homicidal',
    ].map<RedFlagRule>((phrase, i) => ({
      id: `fm-mh-${factType}-${i}`,
      name: 'Mental-health crisis (suicide / self-harm / harm to others)',
      description:
        'Active intent/plan, access to means, recent self-harm, inability to stay safe, or intent to harm others → emergency (911 and/or 988). Passive thoughts without plan are urgent follow-up (off the gate).',
      conditions: [{ factType, operator: 'contains', value: phrase }],
      action: ED,
      enabled: true,
    })),
  ),

  // ── Tier 2 — Surgical abdomen / AAA (→ ED) ──
  ...gate(
    'fm-abdomen',
    'Surgical abdomen / AAA',
    'Rigid/board-like belly, guarding, bilious/feculent vomiting, severe distension, suspected AAA (≥60, sudden severe abdominal/flank/back pain ± faintness ± pulsing mass), dissection, or mesenteric ischemia.',
    [
      'rigid_abdomen',
      'rigid abdomen',
      'board_like_abdomen',
      'board-like',
      'board like belly',
      'guarding',
      'bilious_vomiting',
      'bilious vomiting',
      'feculent_vomiting',
      'surgical_abdomen',
      'aaa',
      'aortic aneurysm',
      'pulsatile_abdominal_mass',
      'pulsing mass',
      'mesenteric_ischemia',
    ],
  ),

  // ── Tier 2 — OB emergencies: ectopic / eclampsia / heavy bleeding (→ ED) ──
  ...gate(
    'fm-ob',
    'OB emergency (ectopic / eclampsia / heavy bleeding)',
    'Pregnant or ≤6wk postpartum: suspected ectopic (pelvic pain + bleeding ± shoulder-tip pain ± faintness), eclampsia (seizure) / severe preeclampsia, heavy bleeding (>1 pad/hr or large clots), or postpartum chest pain/SOB/unilateral leg swelling.',
    [
      'ectopic',
      'ectopic_pregnancy',
      'eclampsia',
      'preeclampsia',
      'severe_preeclampsia',
      'heavy_vaginal_bleeding',
      'heavy vaginal bleeding',
      'soaking a pad',
      'postpartum_hemorrhage',
      'decreased_fetal_movement',
      'shoulder_tip_pain',
      'shoulder tip pain',
    ],
  ),

  // ── Tier 2 — Testicular / scrotal torsion (→ ED, time-critical) ──
  ...gate(
    'fm-torsion',
    'Acute testicular / scrotal pain (torsion)',
    'Sudden severe scrotal/groin pain or swelling, testicle riding high, nausea/vomiting — time-critical for torsion.',
    ['testicular_torsion', 'testicular torsion', 'testicle pain', 'testicular_pain', 'testicular pain', 'scrotal_pain', 'scrotal pain', 'scrotal_swelling'],
  ),

  // ── Tier 2 — Cauda equina / cord compression / spinal infection (→ ED) ──
  ...gate(
    'fm-cauda',
    'Back pain with neuro red flags (cauda equina / cord)',
    'New urinary retention/incontinence, fecal incontinence, saddle numbness, bilateral leg weakness, a sensory level, or back pain + fever with infection risk. Cauda equina is a surgical emergency — hours matter.',
    [
      'cauda_equina',
      'cauda equina',
      'saddle_anesthesia',
      'saddle_numbness',
      'saddle numbness',
      'urinary_retention',
      'urinary_incontinence',
      'cannot control my bladder',
      'lost control of my bowels',
      'fecal_incontinence',
      'bilateral_leg_weakness',
      'both legs weak',
      'cord_compression',
    ],
  ),

  // ── Tier 2 — Diabetic emergencies: DKA / HHS / hypoglycemia (→ ED) ──
  ...gate(
    'fm-diabetic',
    'Diabetic emergency (DKA / HHS / hypoglycemia)',
    'DKA (high glucose + ketones, vomiting, deep rapid breathing, fruity breath, drowsiness; possible on SGLT2 even near-normal glucose), HHS, or severe hypoglycemia (sweaty/shaky/confused/combative/unconscious/seizing).',
    [
      'dka',
      'diabetic_ketoacidosis',
      'ketoacidosis',
      'hhs',
      'severe_hypoglycemia',
      'hypoglycemia',
      'severe low blood sugar',
      'ketones',
      'fruity_breath',
      'fruity breath',
    ],
  ),

  // ── Tier 2 — DVT / PE (→ ED) ──
  ...gate(
    'fm-pe',
    'DVT / pulmonary embolism',
    'PE: sudden breathlessness + pleuritic chest pain + fast heart rate ± near-faint ± hemoptysis, with clot risk. DVT: one-sided leg swelling/pain/warmth. Encoded UP given how fast PE deteriorates.',
    [
      'pulmonary_embolism',
      'pulmonary embolism',
      'blood clot in lung',
      'pleuritic_chest_pain',
      'pleuritic chest pain',
      'coughing_blood',
      'coughing up blood',
      'hemoptysis',
      'dvt',
      'deep_vein_thrombosis',
      'unilateral_leg_swelling',
      'one leg swollen',
      'calf pain and swelling',
    ],
  ),

  // ── Tier 2 — Head injury WITH danger features (→ ED) ──
  ...gate(
    'fm-headinjury-severe',
    'Head injury with danger features',
    'Head injury with LOC, repeated vomiting, worsening headache, confusion, focal deficit, or seizure.',
    ['head_injury_with_loc', 'head_injury_vomiting', 'head_injury_confusion', 'head_injury_seizure'],
  ),

  // ── Tier 2 — Head injury ON anticoagulation (→ ED) ──
  // Two-condition AND: a head-injury fact + the anticoagulation context (the protocol's lower
  // threshold — intracranial bleeding can be delayed/silent). Both conditions match on VALUE via
  // `contains`; the head-injury phrase is checked across symptom + chief_complaint so factType drift
  // doesn't drop it, and the anticoag context is read from the `condition` factType OR symptom text.
  ...['symptom', 'chief_complaint'].flatMap((injuryFactType) =>
    ['anticoagulant', 'anticoagulated', 'blood thinner', 'blood_thinner', 'antiplatelet', 'warfarin', 'apixaban', 'rivaroxaban', 'dabigatran', 'clopidogrel'].flatMap((anticoagPhrase, j) =>
      ['head injury', 'head_injury', 'hit head', 'hit_head', 'head trauma', 'fall and hit', 'fell and hit'].map<RedFlagRule>((injuryPhrase, k) => ({
        id: `fm-headinjury-anticoag-${injuryFactType}-${j}-${k}`,
        name: 'Head injury on anticoagulation',
        description:
          'Any head injury / fall WHILE on anticoagulants or antiplatelets — intracranial bleeding can be delayed and silent, so escalate even if currently well.',
        conditions: [
          { factType: injuryFactType, operator: 'contains', value: injuryPhrase },
          { factType: 'condition', operator: 'contains', value: anticoagPhrase },
        ],
        action: ED,
        enabled: true,
      })),
    ),
  ),
];

/**
 * Build the UNSIGNED familymed-v1 bundle via the existing createPolicyBundle path. Thresholds +
 * prohibited patterns are inherited from the defaults (the gates are what change). Metadata carries
 * the protocol provenance.
 */
export function buildFamilymedBundle(): PolicyBundle {
  return createPolicyBundle({
    policyVersion: FAMILYMED_BUNDLE_VERSION,
    signedBy: 'Michael Hobbs, MD',
    changeNote: 'Schmitt-Thompson adult telephone protocols (adapted) — family-medicine triage gates.',
    redFlagRules: FAMILYMED_RED_FLAG_RULES,
    urgencyThresholds: DEFAULT_URGENCY_THRESHOLDS,
    allowedActions: [...ALLOWED_ACTIONS],
    prohibitedOutputPatterns: DEFAULT_PROHIBITED_PATTERNS,
  });
}

/**
 * The runtime familymed-v1 bundle: SIGNED with VOICE_CONFIG_HMAC_SECRET when set (so the provable
 * trace renders "signature verified ✓"), unsigned otherwise (local / tests). Mirrors
 * activePolicyBundle()'s env handling — reading the secret is a LOADER concern; the decision stays
 * env-free.
 */
export function activeFamilymedBundle(): PolicyBundle {
  const base = buildFamilymedBundle();
  const secret = process.env.VOICE_CONFIG_HMAC_SECRET;
  return secret ? signBundle(base, secret) : base;
}

/** Bundle registry metadata (author / source) — read by engine/index.ts when registering. */
export const FAMILYMED_BUNDLE_METADATA = {
  policyVersion: FAMILYMED_BUNDLE_VERSION,
  author: 'Michael Hobbs, MD',
  source: 'Schmitt-Thompson adult telephone protocols (adapted)',
} as const;
