/**
 * ⛓ FROZEN CONTRACT — the swappable provider seam (comms + EHR).
 *
 * Cara is the DEFAULT implementation (one key + the Cara number). Swapping to
 * SendGrid / Twilio / another EHR is a CONFIG change, not a code change (runbook §8, T5).
 * Every provider is vendor-agnostic behind these interfaces.
 *
 * Changing a frozen contract mid-build = a coordinated edit logged in RUN_STATE.md.
 */

export type CommsVendor = 'cara' | 'twilio' | 'sendgrid';
export type EhrVendor = 'elation' | 'canvas' | 'healthie';

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

/** Outbound comms (SMS / email) + OTP — the patient-facing channel + identity transport. */
export interface CommsProvider {
  readonly vendor: CommsVendor;
  sendSms(to: string, body: string): Promise<SendResult>;
  sendEmail(to: string, subject: string, body: string): Promise<SendResult>;
  /** OTP request/verify ride comms; raw destination is never logged. */
  requestOtp(to: string, channel: 'sms' | 'email'): Promise<{ challengeId: string; expiresAt: string }>;
  verifyOtp(challengeId: string, code: string): Promise<{ verified: boolean }>;
}

/** A minimal, PHI-careful EHR read/write surface via the vendor-agnostic proxy. */
export interface PatientRef {
  /** Opaque EHR id — not a name/DOB. */
  externalId: string;
}

export interface EhrAdapter {
  readonly vendor: EhrVendor;
  /** Search returns opaque refs; the caller resolves details server-side only. */
  searchPatient(query: { fullName: string; dateOfBirth: string }): Promise<PatientRef[]>;
  getPatient(ref: PatientRef): Promise<Record<string, unknown> | null>;
  /** Write a triage note / disposition back to the chart. */
  writeNote(ref: PatientRef, note: { title: string; body: string }): Promise<SendResult>;
}

/** Provider registry config — selects the impls at boot (config, not code). */
export interface ProviderConfig {
  comms: CommsVendor;
  ehr: EhrVendor;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  comms: 'cara',
  ehr: 'elation',
};
