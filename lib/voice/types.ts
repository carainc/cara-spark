/**
 * ⛓ FROZEN CONTRACT #4 of 4 — voice register-agent + post-call-result.
 *
 * The OSS app registers an agent against the STANDALONE LiveKit (T13 — never the prod
 * cara-realtime stack) and exposes a NO-PHI policy-decision endpoint. After a call, the
 * worker posts a result that drops into the review queue + the call audit trail (T11).
 *
 * Bilingual EN/ES is core: each call carries its language; STT/TTS select accordingly.
 * Changing a frozen contract mid-build = a coordinated edit logged in RUN_STATE.md.
 */
import type { AdjudicationTrace, AllowedAction, EvidenceFact, RiskEstimate } from '@/engine/types';
import type { VerifiedIdentity } from '@/lib/identity/types';

export type CallLanguage = 'en' | 'es';

/** Registration: tells the standalone LiveKit worker which agent + policy to run for a room. */
export interface VoiceAgentRegistration {
  agentId: string;
  agentName: string;
  /** Explicit SIP dispatch: the worker registers THIS name; room_config.agents=[name]. */
  workerName: string;
  language: CallLanguage;
  policyBundleVersion: string;
  /** HMAC signature over the config (VOICE_CONFIG_HMAC_SECRET) — tamper-evident. */
  configSignature: string;
}

/**
 * The no-PHI policy-decision request the voice worker makes mid-call. Carries proposed
 * evidence + risk (model-proposed) — NEVER raw identifiers. Identity is the opaque ref only.
 */
export interface VoicePolicyDecisionRequest {
  agentId: string;
  callId: string;
  language: CallLanguage;
  identity: VerifiedIdentity;
  evidence: EvidenceFact[];
  riskEstimate: RiskEstimate;
}

export interface VoicePolicyDecisionResponse {
  action: AllowedAction;
  /** Canned, policy-authored guidance text in the call language (model cannot soften it). */
  guidance: string;
  trace: AdjudicationTrace;
}

/** Posted by the worker when a call ends → review queue + audit trail (T11). */
export interface PostCallResult {
  callId: string;
  agentId: string;
  language: CallLanguage;
  startedAt: string;
  endedAt: string;
  /** Final deterministic disposition. */
  disposition: AllowedAction;
  /** The provable trace (the showcase) — NOT raw transcript PHI. */
  trace: AdjudicationTrace;
  /** Reference to the redacted/synthetic transcript store (no-PHI). */
  transcriptRef?: string;
}

/** The voice port. Impl (Lane G / T10+T13) lives in lib/voice/*.ts. */
export interface VoiceGateway {
  registerAgent(reg: VoiceAgentRegistration): Promise<{ ok: boolean; dispatchName: string }>;
  decide(req: VoicePolicyDecisionRequest): Promise<VoicePolicyDecisionResponse>;
  postCallResult(result: PostCallResult): Promise<{ ok: boolean }>;
}
