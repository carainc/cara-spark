/**
 * Kiosk spoken-text assembly (T16). The kiosk has NO screen, so every word is spoken. We REUSE
 * the voice lane's TTS-shaped, policy-authored guidance (lib/voice/guidance.ts — "9 1 1" spelled
 * out for the TTS) rather than the chat-panel guidance, and the bilingual spoken disclaimer from
 * the i18n dict. No clinical text is authored here — it is all canned, engine-keyed, verbatim.
 */
import type { AllowedAction } from '@/engine/types';
import { guidanceFor as spokenGuidanceFor, isTerminalEscalation } from '@/lib/voice/guidance';
import { getDict } from '@/lib/i18n';
import type { KioskLang } from './types';

/** The spoken greeting + not-emergency-care disclaimer, played on wake (build guide §5). */
export function spokenDisclaimer(lang: KioskLang): string {
  return getDict(lang).kiosk.disclaimer;
}

/** The spoken fail-safe message when the box cannot reach the server (build guide §7). */
export function spokenOffline(lang: KioskLang): string {
  return getDict(lang).kiosk.offline;
}

/**
 * The spoken guidance for the engine's decided action, in the caller's language. Verbatim,
 * policy-authored — the model can never soften it (this is the same text the voice worker speaks).
 */
export function spokenGuidance(action: AllowedAction, lang: KioskLang): string {
  return spokenGuidanceFor(action, lang);
}

/** True when this action is an emergency/handoff escalation — the device plays the distinct chime + red LED. */
export function isKioskEscalation(action: AllowedAction): boolean {
  return isTerminalEscalation(action);
}
