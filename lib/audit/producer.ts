/**
 * Audit producer (T11 / CAR-2390) — the WRITE path. On each completed call/turn it persists the
 * provable trace (Call + AuditEntry rows), NOT raw transcript PHI.
 *
 * NO-PHI discipline (AGENTS.md §Security): we store the engine TRACE — evidence facts, the red-flag
 * result, the model's risk estimate, the deterministic decision, and the bundle version+checksum —
 * never the raw transcript. Transcripts live behind an opaque `transcriptRef` (synthetic/redacted
 * store). Identity is the opaque `identityRef` only.
 *
 * The headline field is `intervention`: did the deterministic engine OVERRIDE or DOMINATE the model
 * at this step? That boolean is what the audit viewer highlights (demo beat 2-replay). It is
 * computed from the trace, deterministically — see `detectIntervention`.
 *
 * This module's pure mappers (traceToAuditEntry, detectIntervention) have no DB/AI deps and are
 * unit-tested directly; the persistence functions take an injected Prisma client.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  AdjudicationTrace,
  AllowedAction,
  PolicyBundle,
  RiskEstimate,
} from '@/engine/types';
import { ACTION_SEVERITY } from '@/engine/types';
import { decide } from '@/engine/policy';
import { computeBundleChecksum } from '@/engine/policy-bundle';

export type CallLanguage = 'EN' | 'ES';
export type CallChannel = 'CHAT' | 'VOICE' | 'PHONE' | 'KIOSK';

/** Why the engine intervened — surfaced verbatim in the viewer's highlight. */
export type InterventionKind =
  | 'red_flag_escalation' // a red-flag rule fired → canned escalation, probabilities not consulted
  | 'engine_overruled_model' // the engine's action differs from what the model's risk alone implied
  | 'blocked_fail_closed'; // fail-closed gate forced BLOCK_AND_HUMAN_HANDOFF

export interface InterventionResult {
  intervened: boolean;
  kinds: InterventionKind[];
  /** Rule ids that fired (empty when the intervention was a non-red-flag block). */
  ruleIdsFired: string[];
  /** What the model's risk ALONE would have produced (red flags ignored) — for the "overruled" view. */
  modelProposedAction: AllowedAction;
  /** The engine's actual, binding decision. */
  engineAction: AllowedAction;
}

/**
 * What would the policy have decided from the model's risk estimate ALONE, with NO red flags? That
 * is the model's "proposal". If the engine's real action differs, the engine overruled the model.
 * Pure: re-runs the deterministic `decide` with an empty red-flag result.
 */
export function modelProposedAction(risk: RiskEstimate, bundle: PolicyBundle): AllowedAction {
  return decide({ triggered: false, hits: [] }, risk, bundle).action;
}

/**
 * Detect whether the engine intervened on this trace, and why. Deterministic, pure.
 * `bundle` is optional: with it we can compute the model-proposed action for the "overruled" signal;
 * without it we still detect red-flag and fail-closed interventions from the trace alone.
 */
export function detectIntervention(
  trace: AdjudicationTrace,
  bundle?: PolicyBundle,
): InterventionResult {
  const kinds: InterventionKind[] = [];
  const engineAction = trace.decision.action;
  const ruleIdsFired = trace.redFlagResult.hits.map((h) => h.ruleId);

  // 1. A red-flag rule fired → escalation dominates regardless of the model's probabilities.
  if (trace.redFlagResult.triggered) {
    kinds.push('red_flag_escalation');
  }

  // 2. Fail-closed block (the inference gate / abstention forced a human handoff).
  if (engineAction === 'BLOCK_AND_HUMAN_HANDOFF') {
    kinds.push('blocked_fail_closed');
  }

  // 3. Engine overruled the model's proposed disposition (needs the bundle to recompute the proposal).
  const proposed = bundle ? modelProposedAction(trace.riskEstimate, bundle) : engineAction;
  if (bundle && ACTION_SEVERITY[proposed] !== ACTION_SEVERITY[engineAction]) {
    if (!kinds.includes('engine_overruled_model')) kinds.push('engine_overruled_model');
  }

  return {
    intervened: kinds.length > 0,
    kinds,
    ruleIdsFired,
    modelProposedAction: proposed,
    engineAction,
  };
}

/** The AuditEntry row shape (mirrors db/schema.prisma `AuditEntry`, minus DB-generated fields). */
export interface AuditEntryRow {
  seq: number;
  evidenceJson: AdjudicationTrace['evidence'];
  redFlagJson: AdjudicationTrace['redFlagResult'];
  riskJson: RiskEstimate;
  decisionJson: AdjudicationTrace['decision'];
  bundleVersion: string;
  bundleChecksum: string;
  intervention: boolean;
  ruleIdsFired: string[];
}

/**
 * Pure mapping: an AdjudicationTrace → an AuditEntry row. The bundle checksum is taken from the
 * trace's verified BundleVerification (the engine already verified it). `bundle` (optional) sharpens
 * the intervention signal to include "engine overruled the model".
 */
export function traceToAuditEntry(
  trace: AdjudicationTrace,
  seq: number,
  bundle?: PolicyBundle,
): AuditEntryRow {
  const intervention = detectIntervention(trace, bundle);
  return {
    seq,
    evidenceJson: trace.evidence,
    redFlagJson: trace.redFlagResult,
    riskJson: trace.riskEstimate,
    decisionJson: trace.decision,
    bundleVersion: trace.bundle.policyVersion,
    bundleChecksum: trace.bundle.checksum,
    intervention: intervention.intervened,
    ruleIdsFired: intervention.ruleIdsFired,
  };
}

export interface RecordCallInput {
  agentId: string;
  channel: CallChannel;
  language?: CallLanguage;
  /** Opaque, PHI-free identity handle ONLY — never name/DOB. */
  identityRef?: string;
  /** Pointer to a redacted/synthetic transcript store (no raw PHI persisted). */
  transcriptRef?: string;
  /** The per-turn traces, in order. The last trace's action becomes the call disposition. */
  traces: AdjudicationTrace[];
  /** Optional bundle for the sharper "overruled" intervention signal. */
  bundle?: PolicyBundle;
}

export interface RecordCallResult {
  callId: string;
  auditEntryIds: string[];
  disposition: AllowedAction | null;
  /** Count of turns where the engine intervened (the headline the viewer surfaces). */
  interventionCount: number;
}

/**
 * Persist a completed call: one Call row + an ordered AuditEntry per trace. The disposition is the
 * final trace's deterministic action. Returns ids + how many turns the engine intervened on.
 *
 * `prisma` is injected so tests can run against a throwaway test DB (no live network).
 */
export async function recordCall(
  prisma: PrismaClient,
  input: RecordCallInput,
): Promise<RecordCallResult> {
  const language = input.language ?? 'EN';
  const lastTrace = input.traces[input.traces.length - 1];
  const disposition = (lastTrace?.decision.action as AllowedAction) ?? null;

  const call = await prisma.call.create({
    data: {
      agentId: input.agentId,
      channel: input.channel,
      language,
      identityRef: input.identityRef ?? null,
      transcriptRef: input.transcriptRef ?? null,
      disposition: disposition ?? null,
      endedAt: new Date(),
    },
  });

  const auditEntryIds: string[] = [];
  let interventionCount = 0;
  for (let i = 0; i < input.traces.length; i++) {
    const row = traceToAuditEntry(input.traces[i], i, input.bundle);
    if (row.intervention) interventionCount += 1;
    const entry = await prisma.auditEntry.create({
      data: {
        callId: call.id,
        seq: row.seq,
        // Prisma Json columns accept plain objects; the trace is already PHI-free structured data.
        evidenceJson: row.evidenceJson as object,
        redFlagJson: row.redFlagJson as object,
        riskJson: row.riskJson as object,
        decisionJson: row.decisionJson as object,
        bundleVersion: row.bundleVersion,
        bundleChecksum: row.bundleChecksum,
        intervention: row.intervention,
        ruleIdsFired: row.ruleIdsFired,
      },
    });
    auditEntryIds.push(entry.id);
  }

  return { callId: call.id, auditEntryIds, disposition, interventionCount };
}

/**
 * Convenience: persist directly from the frozen voice `PostCallResult` seam (lib/voice/types.ts).
 * The voice worker (Lane G) posts that shape when a call ends → it drops straight into the audit
 * trail. We accept a minimal structural subset to avoid a hard import cycle with lib/voice.
 */
export interface PostCallResultLike {
  callId?: string;
  agentId: string;
  language: 'en' | 'es';
  startedAt?: string;
  endedAt?: string;
  disposition: AllowedAction;
  trace: AdjudicationTrace;
  transcriptRef?: string;
  identityRef?: string;
  channel?: CallChannel;
}

export async function recordVoiceCall(
  prisma: PrismaClient,
  result: PostCallResultLike,
  bundle?: PolicyBundle,
): Promise<RecordCallResult> {
  return recordCall(prisma, {
    agentId: result.agentId,
    channel: result.channel ?? 'PHONE',
    language: result.language === 'es' ? 'ES' : 'EN',
    identityRef: result.identityRef,
    transcriptRef: result.transcriptRef,
    traces: [result.trace],
    bundle,
  });
}
