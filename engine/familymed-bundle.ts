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

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // Red-team self-improve expansion (tk-0011). Each gate below ADDS escalation only (→ ED), closing
  // a documented under-triage gap where a patient's plain-language danger signal matched no existing
  // phrase. Authored from /tmp/probe-findings.json clinical axes; ambiguity escalates UP.
  // ════════════════════════════════════════════════════════════════════════════════════════════

  // ── Abdominal / GU / OB-GYN / renal axis ──

  // Bowel obstruction — obstipation + distension + vomiting in plain words (fm-abdomen only caught
  // coded bilious/feculent vomiting or a rigid belly).
  ...gate(
    'fm-bowel-obstruction',
    'Bowel obstruction (obstipation + distension + vomiting)',
    'Not passing gas or stool (obstipation) with a distended belly and vomiting — bowel obstruction at risk of ischemia/perforation.',
    [
      'bowel obstruction',
      'intestinal obstruction',
      'obstipation',
      "can't pass gas",
      'cant pass gas',
      'no gas or stool',
      'not passing gas',
      "haven't pooped or passed gas",
      'havent pooped or passed gas',
      "can't poop and throwing up",
      'no bowel movement and vomiting',
      'belly is bloated and vomiting',
      'distended belly vomiting',
      'abdominal distension with vomiting',
    ],
  ),

  // Incarcerated / strangulated hernia — a non-reducible, tender groin/abdominal bulge (no existing
  // gate mentions hernia or an irreducible bulge).
  ...gate(
    'fm-hernia',
    'Incarcerated / strangulated hernia',
    'A hernia/bulge that will not push back in, is hard/tender, or is red/painful with nausea — incarceration minutes-to-hours from strangulation/bowel necrosis.',
    [
      'incarcerated hernia',
      'strangulated hernia',
      'hernia stuck',
      "hernia won't go back in",
      'hernia wont go back in',
      'hernia bulge painful',
      "bulge in my groin won't go back",
      "bulge in my groin that won't push back in",
      "lump in my groin won't go back",
      'painful groin bulge and vomiting',
      'hernia hard and tender',
      'hernia turning red and painful',
    ],
  ),

  // Brisk lower-GI / rectal bleeding — bright-red hematochezia with presyncope (fm-bleed only caught
  // upper-GI: hematemesis/coffee-ground/melena/maroon stool).
  ...gate(
    'fm-lgi-bleed',
    'Severe lower-GI / rectal bleeding',
    'Large-volume bright-red rectal bleeding / clots, especially with faintness or dizziness — can exsanguinate; needs emergent evaluation.',
    [
      'rectal bleeding',
      'bleeding from my rectum',
      'bleeding from my bottom',
      'blood in the toilet',
      'toilet full of blood',
      'passing a lot of blood',
      'lots of blood in my stool',
      'lots of blood when i poop',
      'bright red blood when i poop',
      'hematochezia',
      'passing clots from my rectum',
      'bleeding from below and feel faint',
      'bleeding from below and dizzy',
    ],
  ),

  // Ovarian / adnexal torsion — sudden severe one-sided pelvic pain + vomiting in a non-pregnant
  // woman (fm-ob is pregnancy-only; fm-torsion is testicular-only).
  ...gate(
    'fm-ovarian-torsion',
    'Ovarian / adnexal torsion',
    'Sudden severe one-sided pelvic/lower-belly pain with vomiting — ovarian torsion strangulates the ovary (salvage is hours).',
    [
      'ovarian torsion',
      'ovary torsion',
      'adnexal torsion',
      'twisted ovary',
      'sudden severe pelvic pain and vomiting',
      'sudden one-sided pelvic pain and vomiting',
      'sudden sharp ovary pain',
      'sudden severe lower belly pain on one side and throwing up',
      'ovarian cyst sudden severe pain',
    ],
  ),

  // Priapism — prolonged painful erection (ischemic compartment syndrome of the penis; no gate).
  ...gate(
    'fm-priapism',
    'Priapism (prolonged painful erection)',
    'A painful erection lasting hours / >4 hours — ischemic priapism causes irreversible fibrosis/impotence past ~4 hours.',
    [
      'priapism',
      "erection that won't go away",
      'erection that wont go away',
      "erection won't go down",
      'erection wont go down',
      "erection that won't go down",
      'erection that wont go down',
      'painful erection',
      'painful erection for hours',
      'erection lasting hours',
      "hard on that won't go away",
      'erection more than 4 hours',
      'more than 4 hours',
    ],
  ),

  // Acute urinary retention — plain "can't pee at all" + painful full bladder (the only retention
  // phrases lived in fm-cauda as the coded token urinary_retention).
  ...gate(
    'fm-urinary-retention',
    'Acute urinary retention',
    "Complete inability to pass urine with a painful, over-distended bladder — causes obstructive renal injury; emergent drainage.",
    [
      "can't pee at all",
      'cant pee at all',
      "can't urinate at all",
      'cannot urinate at all',
      "can't pass urine",
      'unable to urinate',
      "haven't peed all day and bladder hurts",
      'havent peed all day and bladder hurts',
      "bladder feels like it's going to burst",
      'bladder is going to burst',
      'no urine and lower belly is full and painful',
      "can't empty my bladder",
    ],
  ),

  // Late-pregnancy vaginal bleeding / abruption — any third-trimester bleeding (fm-ob required the
  // exact 'heavy vaginal bleeding'/'soaking a pad'/PPH substrings).
  ...gate(
    'fm-late-preg-bleed',
    'Late-pregnancy vaginal bleeding / abruption',
    'Any vaginal bleeding in late/third-trimester pregnancy (abruption/previa), or bloody/green broken waters — a life threat to mother and fetus.',
    [
      'bleeding in third trimester',
      'third trimester bleeding',
      'pregnant and bleeding',
      'bleeding and pregnant',
      'vaginal bleeding in late pregnancy',
      'gush of blood pregnant',
      'placental abruption',
      'placenta previa bleeding',
      'pregnant constant severe belly pain and bleeding',
      "water broke and it's bloody",
      'water broke and its bloody',
      "water broke and it's green",
    ],
  ),

  // Pyelonephritis / urosepsis by symptoms — UTI + fever + rigors + flank pain (fm-sepsis needed the
  // coded tokens; plain 'fever' fires no temp-threshold rule in this bundle).
  ...gate(
    'fm-pyelonephritis',
    'Pyelonephritis / urosepsis',
    'Burning urination or UTI WITH fever, shaking chills/rigors, and flank/back pain (± vomiting) — ascending kidney infection that can decompensate into septic shock.',
    [
      'pyelonephritis',
      'kidney infection',
      'urosepsis',
      'burning when i pee with fever and chills',
      'uti with fever and chills',
      'uti with back pain and fever',
      'flank pain with fever and chills',
      'flank pain and fever and vomiting',
      'back pain fever and shaking chills',
      'urine infection and shaking chills',
      'kidney pain with fever',
    ],
  ),

  // Infected / obstructing kidney stone (incl. single kidney) — stone + fever/anuria/solitary kidney
  // (no current gate covers a stone with these complications).
  ...gate(
    'fm-obstructing-stone',
    'Infected / obstructing kidney stone (incl. single kidney)',
    'Flank pain like a stone PLUS fever/chills (obstructed infected system — emergent decompression), or a stone with anuria / in a single kidney (anuric AKI).',
    [
      'kidney stone with fever',
      'kidney stone and fever',
      'stone and fever and chills',
      'kidney stone and shaking chills',
      'worst flank pain and fever',
      'kidney stone and only have one kidney',
      'kidney stone single kidney',
      'kidney stone and not peeing',
      "stone and can't pee",
      'stone and no urine',
    ],
  ),

  // ── Cardiopulmonary & neurologic axis ──

  // Aortic dissection presenting as tearing BACK/interscapular pain (fm-acs only matched the literal
  // 'tearing chest'/'ripping chest' substrings, missing a back-only presentation).
  ...gate(
    'fm-dissection-back',
    'Aortic dissection — tearing/ripping pain to the back',
    'Sudden tearing/ripping pain, especially radiating to the back or between the shoulder blades — thoracic aortic dissection kills ~1-2%/hour untreated.',
    [
      'tearing pain',
      'ripping pain',
      'tearing sensation',
      'ripping sensation',
      'tearing feeling',
      'ripping feeling',
      'tearing in my back',
      'ripping in my back',
      'between my shoulder blades',
      'between the shoulder blades',
      'tearing between',
      'aortic dissection',
      'dissection',
      'tearing pain in my back',
      'tearing back pain',
    ],
  ),

  // Posterior-circulation stroke — sudden vertigo + gait failure / veering (anterior FAST gate misses
  // ~20-25% of ischemic strokes that are posterior).
  ...gate(
    'fm-posterior-stroke',
    'Posterior-circulation stroke (vertigo + gait/coordination)',
    'Sudden severe vertigo with vomiting and inability to walk / veering to one side — cardinal sign of cerebellar/posterior-circulation stroke (FAST-negative).',
    [
      'room is spinning',
      'room spinning',
      'everything is spinning',
      'sudden vertigo',
      "spinning and can't walk",
      "can't walk straight",
      'cannot walk straight',
      'veering to one side',
      'falling to one side',
      'keep falling over',
      'lost my balance suddenly',
      'sudden loss of balance',
      'ataxia',
      'uncoordinated',
      'vertigo and vomiting',
    ],
  ),

  // Meningitis / encephalitis — headache + fever + photophobia (fm-headache caught 'stiff neck' but
  // not photophobia or the lay word 'meningitis').
  ...gate(
    'fm-meningitis',
    'Meningitis / encephalitis (photophobia + neck stiffness)',
    'Headache with fever and light hurting the eyes (photophobia) ± a neck too stiff to bend — bacterial meningitis/encephalitis is hours-critical.',
    [
      'light hurts my eyes',
      'light really hurts my eyes',
      "can't stand the light",
      'cannot stand bright light',
      'bright light hurts',
      'photophobia',
      'stiff neck and fever',
      'neck stiff and fever',
      "can't touch chin to chest",
      'cannot bend my neck',
      "can't bend my neck forward",
      'headache fever stiff neck',
      'meningitis',
      'encephalitis',
    ],
  ),

  // Pneumothorax (collapsed lung) — sudden one-sided STABBING pleuritic pain + SOB (fm-acs keys on
  // pressure/tightness/crushing; fm-dyspnea needs severe-distress words).
  ...gate(
    'fm-pneumothorax',
    'Pneumothorax (collapsed lung) — sudden one-sided chest pain + SOB',
    'Sudden sharp/stabbing one-sided chest pain with shortness of breath / a sense the lung collapsed — tension pneumothorax is rapidly fatal; spontaneous needs urgent decompression.',
    [
      'collapsed lung',
      'lung collapsed',
      'pneumothorax',
      'tension pneumothorax',
      'sudden sharp pain on one side',
      'sharp stabbing pain on one side',
      'stabbing pain when i breathe',
      'sharp pain when i breathe in',
      'stabbing chest pain on one side',
      'sudden one-sided chest pain',
      "can't take a deep breath",
      'cannot take a full breath',
    ],
  ),

  // Cardiac tamponade — breathlessness + lightheadedness + bulging neck veins (its distinctive
  // descriptors match no existing gate).
  ...gate(
    'fm-tamponade',
    'Cardiac tamponade (neck-vein distension + breathlessness)',
    'Increasing breathlessness and lightheadedness with bulging neck veins / known fluid around the heart — obstructive shock minutes-to-hours from arrest.',
    [
      'cardiac tamponade',
      'tamponade',
      'neck veins bulging',
      'neck veins sticking out',
      'neck veins are bulging out',
      'veins in my neck are bulging',
      'muffled heartbeat',
      'fluid around my heart',
      'fluid around the heart',
      'pericardial effusion',
    ],
  ),

  // Generalized seizure described WITHOUT the word "seizure" (fm-seizure only matched the clinical
  // words; bystanders type "jerking/shaking, eyes rolled back").
  ...gate(
    'fm-seizure-lay',
    'Generalized seizure — lay descriptors (jerking / shaking / eyes rolled back)',
    'Witnessed whole-body jerking/shaking, eyes rolled back, foaming at the mouth, or tongue-biting — a first-time generalized seizure warrants ED evaluation.',
    [
      'whole body jerking',
      'whole body shaking',
      'body started jerking',
      'started shaking uncontrollably',
      'shaking uncontrollably',
      'eyes rolled back',
      'eyes rolling back',
      'jerking and shaking',
      'stiffened and started shaking',
      'went stiff and shook',
      'foaming at the mouth',
      'bit his tongue',
      'bit her tongue',
      'uncontrollable jerking',
    ],
  ),

  // Status epilepticus / repeated seizures by description ("wouldn't stop", "didn't wake up between")
  // — fm-seizure misses the natural descriptions that don't contain "seizure"/"convulsion".
  ...gate(
    'fm-status-epilepticus',
    'Status epilepticus — prolonged or repeated seizures / no recovery',
    'Convulsions that would not stop, lasted >5 minutes, came back to back, or with no waking up between — a true 911 emergency with rising mortality per minute.',
    [
      "seizure that won't stop",
      "seizure won't stop",
      "shaking wouldn't stop",
      'shaking would not stop',
      'kept seizing',
      'kept convulsing',
      'one seizure after another',
      'seizures back to back',
      'back to back seizures',
      "didn't wake up between",
      'did not wake up between',
      'still shaking after 5 minutes',
      'shaking for more than 5 minutes',
      'status epilepticus',
    ],
  ),

  // Hypertensive emergency — very high BP reading + end-organ symptoms (no BP-aware gate exists in
  // either bundle).
  ...gate(
    'fm-hypertensive-emergency',
    'Hypertensive emergency (severe BP + end-organ symptoms)',
    'Markedly elevated blood pressure with end-organ symptoms (severe headache, vision change, chest pain, confusion) — needs the ED for controlled lowering.',
    [
      'blood pressure is 2',
      'blood pressure 2',
      'bp is 2',
      'bp of 2',
      'blood pressure is 190',
      'blood pressure is 200',
      'blood pressure is over 180',
      "blood pressure won't come down",
      'blood pressure sky high',
      'blood pressure is dangerously high',
      'hypertensive emergency',
      'hypertensive crisis',
      'really high blood pressure with headache',
    ],
  ),

  // ── Toxic / endocrine / infectious / environmental / pediatric / psych axis ──

  // Opioid / sedative overdose with respiratory depression — bystander description (fm-poisoning only
  // matched 'overdose'/'poisoning'/'took too many pills').
  ...gate(
    'fm-opioid-overdose',
    'Opioid / sedative overdose (respiratory depression)',
    'Took too much of an opioid/sedative with slow/shallow/absent breathing, pinpoint pupils, blue lips, or unrousable — or naloxone given. Kills in minutes.',
    [
      'overdose',
      'overdosed',
      'opioid',
      'fentanyl',
      'heroin',
      'oxycontin',
      'percocet',
      'methadone',
      'took too much',
      'pinpoint pupils',
      'not breathing',
      'barely breathing',
      'stopped breathing',
      'slow breathing',
      'shallow breathing',
      'narcan',
      'naloxone',
      'blue lips',
      "won't wake up",
      'wont wake up',
      "can't wake him",
      'cant wake him',
      'unresponsive after',
      'snorted',
      'shot up',
    ],
  ),

  // Infant lethargy / poor feeding / floppy — the default infant safety-net is NOT merged into this
  // bundle, so a parent's plain words for infant sepsis/meningitis/metabolic crisis miss entirely.
  ...gate(
    'fm-infant-distress',
    'Infant lethargy / poor feeding / floppy (sepsis / meningitis / metabolic)',
    'An infant who is lethargic, limp/floppy, listless, not feeding, hard to rouse, or severely dehydrated (no wet diapers, sunken/bulging soft spot) — cardinal signs of serious infant illness.',
    [
      'lethargic',
      'lethargy',
      "won't feed",
      'wont feed',
      'will not feed',
      'not feeding',
      'poor feeding',
      'stopped feeding',
      'floppy',
      'limp',
      'listless',
      'not waking',
      "won't wake",
      'wont wake',
      'very sleepy',
      'too sleepy to feed',
      'hard to rouse',
      'grunting',
      'not responding',
      'no wet diaper',
      'no wet diapers',
      'dry diaper all day',
      'sunken eyes',
      'no tears when crying',
      'sunken soft spot',
      'bulging soft spot',
      'severely dehydrated',
      'high-pitched cry',
      'inconsolable',
    ],
  ),

  // Carbon monoxide poisoning — nonspecific flu-like symptoms clustering with a fuel-burning source /
  // alarm / multiple people sick (rapidly lethal; nothing catches the clustering clue).
  ...gate(
    'fm-carbon-monoxide',
    'Carbon monoxide poisoning',
    'Headache/nausea/dizziness clustering with a CO alarm, a fuel-burning source (furnace, generator, gas/space heater, car in garage), or several people in the home sick at once.',
    [
      'carbon monoxide',
      'co detector',
      'co alarm',
      'co poisoning',
      'carbon monoxide detector',
      'furnace',
      'generator running',
      'generator in the',
      'gas heater',
      'wood stove',
      'everyone in the house',
      'whole family is sick',
      'everyone is sick',
      'everyone has a headache',
      'headache and nausea and dizzy',
      'exhaust fumes',
      'car running in the garage',
      'space heater',
    ],
  ),

  // Sickle-cell vaso-occlusive / acute chest crisis — cough/fever/SOB without the words "chest pain"
  // (fm-acs only catches it via the 'chest pain' substring).
  ...gate(
    'fm-sickle-cell-crisis',
    'Sickle-cell crisis / acute chest syndrome',
    'A sickle-cell patient with a pain crisis, or with cough/fever/shortness of breath (acute chest syndrome — the leading cause of death in sickle-cell disease).',
    [
      'sickle cell',
      'sickle-cell',
      'vaso-occlusive',
      'vaso occlusive',
      'vasoocclusive',
      'acute chest syndrome',
      'pain crisis',
      'sickle crisis',
      'sickle cell crisis',
    ],
  ),

  // Anaphylaxis in natural language — lip/tongue swelling, throat closing, hives + breathing trouble
  // (fm-anaphylaxis relied on coded/adjacent phrases a patient won't type verbatim).
  ...gate(
    'fm-anaphylaxis-nl',
    'Anaphylaxis (natural-language lip/tongue/throat swelling)',
    'Lips/tongue/face swelling, throat closing, or hives all over after an exposure (± dizziness/breathing trouble) — anaphylaxis is minutes-critical.',
    [
      'lip swelling',
      'lips swelling',
      'swollen lips',
      'tongue swelling',
      'tongue swollen',
      'swollen tongue',
      'throat closing',
      'throat is closing',
      'throat closing up',
      'closing up',
      'swelling up after',
      'face is swelling',
      'whole face swelling',
      'allergic reaction',
      'severe allergic reaction',
      'hives all over',
      'covered in hives',
      'epipen',
      'used an epipen',
      'anaphyla',
    ],
  ),

  // Drowning / submersion (near-drowning) — any submersion event needs ED eval for delayed pulmonary
  // edema/hypoxia even if the child initially looks okay.
  ...gate(
    'fm-drowning',
    'Drowning / submersion (near-drowning)',
    'Any submersion event — pulled from the water/pool, went under, found face-down, swallowed a lot of water — needs ED evaluation for delayed pulmonary edema/hypoxia.',
    [
      'drowning',
      'drowned',
      'near drowning',
      'near-drowning',
      'almost drowned',
      'submerged',
      'went under the water',
      'went under in the',
      'pulled from the water',
      'pulled from the pool',
      'pulled out of the pool',
      'found in the pool',
      'face down in the water',
      'swallowed a lot of water',
      'secondary drowning',
    ],
  ),

  // Airway / inhalation burn — house fire, soot, hoarse, singed, carbonaceous sputum (progressive
  // airway edema; fm-dyspnea's 'stridor' requires that exact word).
  ...gate(
    'fm-inhalation-airway-burn',
    'Inhalation / airway burn',
    'Smoke inhalation or enclosed-space fire with hoarseness, facial/perinasal soot, singed nose hairs, facial burns, or coughing up black sputum — airway edema can occlude over hours.',
    [
      'smoke inhalation',
      'inhaled smoke',
      'breathing in smoke',
      'house fire',
      'trapped in a fire',
      'caught in a fire',
      'soot around',
      'soot in his',
      'soot in her',
      'singed',
      'singed nose hairs',
      'burns to the face',
      'facial burns',
      'hoarse after a fire',
      'coughing black',
      'coughing up black',
      'steam burn to the throat',
      'enclosed space fire',
    ],
  ),

  // Pediatric epiglottitis / severe upper-airway obstruction — drooling + can't swallow + noisy
  // breathing + fever (fm-dyspnea's 'stridor' requires that exact word parents rarely use).
  ...gate(
    'fm-pediatric-airway',
    'Pediatric epiglottitis / upper-airway obstruction',
    'Drooling, inability to swallow, muffled "hot potato" voice, tripod/sitting-up-to-breathe posture, or noisy/whistling breathing (± high fever) — epiglottitis is an airway emergency.',
    [
      'drooling',
      'cannot swallow',
      "can't swallow",
      'cant swallow',
      "won't swallow",
      'difficulty swallowing',
      'stridor',
      'noisy breathing',
      'high-pitched breathing',
      'whistling breathing',
      'muffled voice',
      'hot potato voice',
      'tripod position',
      'sitting up to breathe',
      'epiglottitis',
      'barky cough',
      'retractions',
    ],
  ),

  // Acute psychosis / mania / severe agitation with danger — the mental-health gate only matched
  // explicit suicide/self-harm/homicide phrases; floridly psychotic/manic/agitated misses.
  ...gate(
    'fm-acute-agitation-psychosis',
    'Acute psychosis / mania / severe agitation',
    'Hearing voices / seeing things, hallucinations, paranoia with aggression, mania (no sleep for days), or violent uncontrollable agitation — danger to self/others, possible organic delirium.',
    [
      'hearing voices',
      'seeing things',
      "seeing things that aren't there",
      'hallucinating',
      'hallucinations',
      'psychotic',
      'psychosis',
      'severe agitation',
      'extremely agitated',
      'violent and out of control',
      'out of control',
      "can't be controlled",
      'manic',
      "hasn't slept in days",
      'not slept in days',
      'paranoid and aggressive',
      'threatening to hurt',
      'completely detached from reality',
    ],
  ),

  // Febrile neutropenic / immunocompromised patient — fever on chemo/transplant (the default rf-010
  // needs condition=="immunocompromised" exactly AND temp>101.3, and is not in this bundle).
  ...gate(
    'fm-febrile-immunocompromised',
    'Febrile neutropenic / immunocompromised patient',
    'A fever in a neutropenic or immunocompromised host (on chemo, transplant, immunosuppressants, asplenic, low white count) — febrile neutropenia needs antibiotics within an hour.',
    [
      'neutropenic',
      'neutropenia',
      'febrile neutropenia',
      'on chemo',
      'on chemotherapy',
      'getting chemo',
      'immunocompromised',
      'immunosuppressed',
      'no immune system',
      'low white count',
      'low white blood cells',
      'transplant patient',
      'organ transplant and fever',
      'on immunosuppressants',
      'asplenic',
      'no spleen',
    ],
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
