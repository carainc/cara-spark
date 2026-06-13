/**
 * Policy-authored, bilingual (EN/ES) spoken guidance — the canned text the deterministic
 * engine delivers for each AllowedAction. The MODEL CANNOT SOFTEN THIS: the worker speaks it
 * verbatim and non-interruptibly once the engine decides (the model-proposes / engine-decides
 * split, runbook §3 OSS law #2). It is intentionally short, plain, and safe-by-default.
 *
 * No PHI: this is fixed clinical-routing language only — never a name/DOB/diagnosis.
 *
 * Bilingual EN/ES is core (OSS law #5): every action has both, plus the per-call STT language
 * and Aura TTS voice selection live here so the cascade speaks the caller's language.
 */
import type { AllowedAction } from '@/engine/types';
import type { CallLanguage } from './types';

/** The verbatim guidance line per action, per language. Closed set — matches ALLOWED_ACTIONS. */
const GUIDANCE: Record<AllowedAction, Record<CallLanguage, string>> = {
  SELF_CARE_INFO_ONLY: {
    en: 'Based on what you described, this can usually be cared for at home. If anything changes or gets worse, please contact your clinic.',
    es: 'Según lo que describió, esto generalmente se puede atender en casa. Si algo cambia o empeora, por favor comuníquese con su clínica.',
  },
  ROUTINE_REVIEW: {
    en: "I'm going to have the clinic review this. They'll follow up with you at a routine appointment. This is not an emergency.",
    es: 'Voy a pedir que la clínica revise esto. Le darán seguimiento en una cita de rutina. Esto no es una emergencia.',
  },
  SAME_DAY_REVIEW: {
    en: 'This should be looked at today. I am flagging it for a same-day review by the clinic, and someone will reach out to you.',
    es: 'Esto debe revisarse hoy. Lo estoy marcando para una revisión el mismo día por la clínica, y alguien se comunicará con usted.',
  },
  IMMEDIATE_CLINIC_CALLBACK: {
    en: 'A clinician needs to speak with you right away. I am requesting an immediate callback from the clinic — please keep your phone nearby.',
    es: 'Un profesional clínico necesita hablar con usted de inmediato. Estoy solicitando una llamada inmediata de la clínica; por favor mantenga su teléfono cerca.',
  },
  ED_OR_911_GUIDANCE: {
    en: 'This may be a medical emergency. Please call 9 1 1 or go to the nearest emergency room now. If you cannot, tell me and I will get help.',
    es: 'Esto puede ser una emergencia médica. Por favor llame al 9 1 1 o vaya a la sala de emergencias más cercana ahora. Si no puede, dígame y conseguiré ayuda.',
  },
  BLOCK_AND_HUMAN_HANDOFF: {
    en: "I'm not able to continue with this safely, so I'm connecting you to a person who can help. Please stay on the line.",
    es: 'No puedo continuar con esto de forma segura, así que lo estoy conectando con una persona que puede ayudar. Por favor permanezca en la línea.',
  },
};

/**
 * The policy-authored guidance text for a decided action in the call language. This is what
 * `VoicePolicyDecisionResponse.guidance` carries — authored, not model-generated.
 */
export function guidanceFor(action: AllowedAction, language: CallLanguage): string {
  return GUIDANCE[action][language];
}

/** Actions that LATCH the model out of the call once decided (handoff / emergency / immediate). */
const TERMINAL_ESCALATIONS: ReadonlySet<AllowedAction> = new Set([
  'ED_OR_911_GUIDANCE',
  'IMMEDIATE_CLINIC_CALLBACK',
  'BLOCK_AND_HUMAN_HANDOFF',
]);

/** True when, after this action, the worker must stop the LLM and speak only policy text. */
export function isTerminalEscalation(action: AllowedAction): boolean {
  return TERMINAL_ESCALATIONS.has(action);
}

// ---------------------------------------------------------------------------
// Bilingual STT/TTS selection (Deepgram STT + Deepgram Aura TTS), per call language.
// Aura-2 model ids encode the voice AND the language: `aura-2-<voice>-<lang>`. We pick a
// natural ES voice for Spanish and an EN voice for English. Overridable via env so adopters
// can swap voices without code (BYO-key spirit) — but never hard-code a secret here.
// ---------------------------------------------------------------------------

/** Deepgram STT model + language code per call language (nova-3 is multilingual-capable). */
export function deepgramSttConfig(language: CallLanguage): { model: string; language: string } {
  return language === 'es'
    ? { model: process.env.VOICE_DEEPGRAM_MODEL || 'nova-2', language: 'es' }
    : { model: process.env.VOICE_DEEPGRAM_MODEL || 'nova-3', language: 'en-US' };
}

/** Deepgram Aura TTS model id per call language (es → a Spanish Aura voice). */
export function auraTtsModel(language: CallLanguage): string {
  if (language === 'es') {
    // aura-2 Spanish voice (e.g. celeste/estrella). Overridable; default is a natural ES voice.
    return process.env.VOICE_AURA_MODEL_ES || 'aura-2-celeste-es';
  }
  return process.env.VOICE_AURA_MODEL_EN || 'aura-2-andromeda-en';
}
