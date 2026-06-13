/**
 * No-PHI logging guard for the kiosk lane (mirror of lib/voice/redact.ts; OSS law #3).
 *
 * A kiosk turn is model-blind by construction, but defense-in-depth: we NEVER log the raw
 * request/response. We project to a small, structural, PHI-free shape — counts, the closed-set
 * action, the opaque session ref's presence (never its value), and the trace id only. The
 * `utterance` text is NEVER logged.
 */
import type { KioskSessionRequest, KioskSessionResponse } from './types';

/** Structural, PHI-free projection of a kiosk request — never the utterance, never identifiers. */
export function safeKioskRequestLog(req: KioskSessionRequest) {
  return {
    agentId: req.agentId,
    lang: req.lang,
    hasSessionRef: Boolean(req.sessionRef && req.sessionRef.length > 0),
    utteranceLength: req.utterance.length, // length only — never the content
  } as const;
}

/** Structural, PHI-free projection of a kiosk response — action + trace id + escalation flag. */
export function safeKioskResultLog(res: KioskSessionResponse) {
  return {
    action: res.action,
    isEscalation: res.isEscalation,
    traceId: res.trace.traceId,
    redFlagTriggered: res.trace.redFlagResult.triggered,
    ruleIdsApplied: res.trace.decision.ruleIdsApplied,
  } as const;
}
