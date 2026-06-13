/**
 * Kiosk transport types (T16 / CAR-2395). NOT a frozen contract — the kiosk is a new ingress
 * channel that bridges into the SAME agent loop (lib/agent/loop.ts) + the SAME deterministic
 * engine (@/engine). It adds no triage logic of its own; it only adapts a one-button device's
 * spoken turn to the loop's typed inputs and back.
 *
 * ANONYMOUS by design: a session carries an opaque, ephemeral `sessionRef` only — never a name,
 * DOB, phone, or account. Identity into the model is always the unverified (model-blind) block.
 */
import type { AdjudicationTrace, AllowedAction } from '@/engine/types';

export type KioskLang = 'en' | 'es';

/**
 * One push-to-talk turn from a kiosk. The device streams audio in the real Pi build; the OSS
 * server transcribes it (Deepgram, voice lane) to `utterance`. The `--sim` client skips audio
 * and sends typed text directly — same shape, no hardware.
 *
 * NO identifiers: `utterance` is symptom speech only; the device never collects identity. The
 * server is model-blind regardless (the loop attaches the unverified identity block).
 */
export interface KioskSessionRequest {
  /** The published agent this kiosk is bound to (must match the device token's binding). */
  agentId: string;
  /** Reply language. Greeting/disclaimer is always bilingual; the agent replies in this lang. */
  lang: KioskLang;
  /** The transcribed (or typed, in --sim) symptom utterance for this turn. */
  utterance: string;
  /**
   * Opaque, ephemeral session handle the device generates per interaction. Carries NO PHI —
   * it only lets the audit trail group a session's turns. Optional; minted server-side if absent.
   */
  sessionRef?: string;
}

/**
 * What the kiosk speaks back. The device has NO screen, so everything actionable is in
 * `spoken` (bilingual-safe, TTS-shaped). The structured fields drive the LED / chime and the
 * (no-PHI) audit breadcrumb; they are never read aloud as raw data.
 */
export interface KioskSessionResponse {
  /** Opaque session handle (echoed or minted). PHI-free. */
  sessionRef: string;
  /** The deterministic engine's binding action — the model never picks this. */
  action: AllowedAction;
  /** The spoken, policy-authored guidance line in the caller's language. Verbatim — model can't soften it. */
  spoken: string;
  /** True when a red-flag rule fired → emergency escalation; the device plays the distinct chime + red LED. */
  isEscalation: boolean;
  /** The provable trace (PHI-free) for the audit trail — NOT spoken. */
  trace: AdjudicationTrace;
}
