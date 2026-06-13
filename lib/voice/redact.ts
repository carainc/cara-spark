/**
 * No-PHI logging guard (OSS law #3 + Security Considerations).
 *
 * Voice payloads are model-blind by contract — identity is only `{ verified, opaqueRef }`,
 * evidence is typed facts, never a raw transcript. But to be defense-in-depth we NEVER log a
 * decision/post-call payload directly: we project it to a small, structural, PHI-free shape.
 * `safeDecisionLog` / `safePostCallLog` are the ONLY things that should reach a log line.
 */
import type {
  PostCallResult,
  VoicePolicyDecisionRequest,
  VoicePolicyDecisionResponse,
} from './types';

/** Structural, PHI-free projection of a decision request — counts + opaque ids only. */
export function safeDecisionLog(req: VoicePolicyDecisionRequest) {
  return {
    agentId: req.agentId,
    callId: req.callId,
    language: req.language,
    identityVerified: req.identity.verified,
    // opaqueRef is PHI-free by the identity contract; we still don't log its value.
    hasOpaqueRef: req.identity.opaqueRef.length > 0,
    evidenceCount: req.evidence.length,
    // factType is a closed vocabulary, never the value — safe to surface for debugging.
    factTypes: req.evidence.map((e) => e.factType),
    modelVersion: req.riskEstimate.modelVersion,
  } as const;
}

/** Structural, PHI-free projection of a decision response — action + trace id only. */
export function safeDecisionResultLog(res: VoicePolicyDecisionResponse) {
  return {
    action: res.action,
    traceId: res.trace.traceId,
    redFlagTriggered: res.trace.redFlagResult.triggered,
    ruleIdsApplied: res.trace.decision.ruleIdsApplied,
  } as const;
}

/** Structural, PHI-free projection of a post-call result — disposition + refs only. */
export function safePostCallLog(result: PostCallResult) {
  return {
    callId: result.callId,
    agentId: result.agentId,
    language: result.language,
    disposition: result.disposition,
    traceId: result.trace.traceId,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    hasTranscriptRef: Boolean(result.transcriptRef),
  } as const;
}
