/**
 * ⛓ FROZEN CONTRACT #3 of 4 — model-blind identity.
 *
 * THE SAFETY FLEX (T6): name / DOB are captured OUT-OF-BAND (browser → Cara OTP), never
 * routed through the model. The agent runtime only ever receives a `VerifiedIdentity`:
 * a boolean + an OPAQUE reference token. No identifier, ever, reaches model context.
 *
 * Changing a frozen contract mid-build = a coordinated edit logged in RUN_STATE.md.
 */

export type IdentityMethod = 'otp' | 'ehr_match' | 'none';

/**
 * The ONLY identity shape the model/agent may see. `opaqueRef` is a server-minted token
 * (e.g. a random id mapping to a server-side record); it MUST NOT encode name, DOB, phone,
 * email, MRN, or any PHI. Asserting this is a load-bearing test (T6: grep model context).
 */
export interface VerifiedIdentity {
  verified: boolean;
  /** Opaque, PHI-free handle to the out-of-band-verified record. */
  opaqueRef: string;
  verifiedAt?: string;
  method?: IdentityMethod;
}

/** Raw identifiers — exist ONLY browser-side / server-side, NEVER in model context. */
export interface IdentityClaim {
  fullName: string;
  dateOfBirth: string; // ISO yyyy-mm-dd
  phone?: string;
  email?: string;
}

/** Step 1: request an OTP for a claim (server → Cara OTP; raw claim never logged). */
export interface OtpRequest {
  claim: IdentityClaim;
  channel: 'sms' | 'email';
}
export interface OtpRequestResult {
  challengeId: string;
  expiresAt: string;
}

/** Step 2: verify the code → mint the opaque, model-safe identity. */
export interface OtpVerifyRequest {
  challengeId: string;
  code: string;
}

/** The model-blind identity port. Impl (Lane C / T5+T6) lives in lib/identity/*.ts. */
export interface IdentityVerifier {
  requestOtp(req: OtpRequest): Promise<OtpRequestResult>;
  /** Fail-closed: any verify failure returns { verified: false }. */
  verifyOtp(req: OtpVerifyRequest): Promise<VerifiedIdentity>;
}

const UNVERIFIED: VerifiedIdentity = { verified: false, opaqueRef: '', method: 'none' };

/** Convenience constructor for the fail-closed default. */
export function unverifiedIdentity(): VerifiedIdentity {
  return { ...UNVERIFIED };
}
