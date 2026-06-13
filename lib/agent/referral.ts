/**
 * tk-0019 — the ADVISORY, DECISION-INERT referral glue between the engine's decision and the chat
 * panel (demo beat 3). After the engine has ALREADY decided (the AdjudicationTrace is an INPUT here,
 * never an output), this module — for NON-emergency dispositions only — retrieves a community
 * referral resource (food bank / CHC) from Lane F's RAG and renders it as a citation appended AFTER
 * the disposition.
 *
 * THE GUARANTEE, structural (mirrors lib/rag/index.ts):
 *  - This module CONSUMES `trace.decision.action` (read-only) and NEVER produces or alters an
 *    AllowedAction. It returns a `ReferralView | null` — display text + citations only. There is no
 *    code path here that yields a triage action, so the RAG can never change the disposition.
 *  - It runs ONLY for the explicitly-allowlisted non-emergency actions. Every emergency / escalation
 *    disposition (ED/911, immediate callback, human handoff) — and same-day review — returns null:
 *    emergency guidance is never diluted with a "you may also find this helpful" note.
 *  - The retrieval query is built from the engine's TYPED, model-blind evidence (symptom codes +
 *    reason codes) — never raw transcript — so no PHI reaches the RAG. PHI-shaped resources were
 *    already rejected at ingest (assertNoPhi).
 *  - Degrades to null on ANY failure (no embedding key, no resources, store/embed throws): the
 *    referral is optional decoration; it must never break the patient's guidance.
 *
 * Pure-ish: the only side effect is the injected `retrieve` (the RAG seam). No DB, no AI here.
 */
import type { AdjudicationTrace, AllowedAction, EvidenceFact } from '@/engine/types';
import type { Lang } from '@/lib/i18n';
import { buildReferralBlock, type ReferralCitation, type ResourceLanguage } from '@/lib/rag';

/**
 * The ONLY dispositions that surface a referral — the two explicitly non-emergency actions. Defined
 * as an ALLOWLIST (not an emergency denylist) so a NEW action defaults to "no referral", failing
 * safe. SAME_DAY_REVIEW is deliberately excluded: it is time-sensitive, not a self-care endpoint.
 *
 * tk-0027 — the SDOH social-needs lane (engine/policy.ts) routes a PURE resource request
 * (food / housing / transport) to SELF_CARE_INFO_ONLY, which is already in this allowlist — so a
 * social need surfaces the community-resource referral (the food bank, demo beat 3) through this same
 * path. The referral stays DECISION-INERT: it cites a resource, never the disposition, exactly as for
 * a clinical self-care endpoint.
 */
export const REFERRAL_ELIGIBLE_ACTIONS: ReadonlySet<AllowedAction> = new Set<AllowedAction>([
  'SELF_CARE_INFO_ONLY',
  'ROUTINE_REVIEW',
]);

/** True iff a referral note may be appended to this decision. Pure predicate over the action only. */
export function isReferralEligible(action: AllowedAction): boolean {
  return REFERRAL_ELIGIBLE_ACTIONS.has(action);
}

/** The retrieval seam: query → citations. The real impl binds lib/rag retrieveResources + a store. */
export type ReferralRetrieve = (args: {
  tenantId: string;
  query: string;
  language: ResourceLanguage;
  topK?: number;
}) => Promise<ReferralCitation[]>;

export interface ReferralDeps {
  retrieve: ReferralRetrieve;
  tenantId: string;
  /** Advisory similarity floor — citations below this are dropped. Defaults to a permissive 0. */
  minScore?: number;
  /** How many resources to cite. Defaults to 1 (a single nearby resource for the demo). */
  topK?: number;
}

/** The render-ready referral view appended to the trace panel. NO action/disposition field exists. */
export interface ReferralView {
  /** The action the ENGINE already decided — echoed for display copy, never produced here. */
  decidedAction: string;
  citations: ReferralCitation[];
  /** Bilingual advisory note ("these do not change the clinical recommendation"). */
  advisoryNote: string;
}

/** EN/ES (Lang) → the RAG corpus language enum. */
export function toResourceLanguage(lang: Lang): ResourceLanguage {
  return lang === 'es' ? 'ES' : 'EN';
}

/** Fact types whose VALUES are safe, machine-shaped topic codes (never identifiers) for the query. */
const QUERY_FACT_TYPES = new Set(['symptom', 'chief_complaint', 'condition', 'mental_health']);

/**
 * Build a PHI-FREE retrieval query from the engine's typed evidence + risk reason codes. We use ONLY
 * machine-shaped fact values (symptom / chief_complaint / condition / mental_health codes) and the
 * reason codes — never the raw transcript, never an identifier-shaped factType. Numeric vitals / ages
 * / labs are dropped (a query is about the topic, not the patient's numbers). The result is a bag of
 * generic topic words plus a stable community-resources seed so retrieval still works for a thin
 * proposal (e.g. labs-only evidence).
 */
export function buildReferralQuery(evidence: EvidenceFact[], reasonCodes: string[]): string {
  const terms: string[] = [];
  for (const f of evidence) {
    if (QUERY_FACT_TYPES.has(f.factType) && typeof f.value === 'string') terms.push(f.value);
  }
  for (const code of reasonCodes) {
    if (typeof code === 'string') terms.push(code);
  }
  terms.push('community resources clinic food assistance');

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const t of terms) {
    const norm = t.replace(/[_-]+/g, ' ').trim().toLowerCase();
    if (norm.length > 0 && !seen.has(norm)) {
      seen.add(norm);
      cleaned.push(norm);
    }
  }
  return cleaned.join(' ');
}

/**
 * The advisory hook. Given a DECIDED trace + the caller language + an (optional) RAG seam, return a
 * referral view to append to the panel, or null to append nothing. NEVER throws — any failure
 * degrades to null. NEVER returns or reads back an action: it takes `trace.decision.action` as an
 * opaque string for display copy only, so it is structurally incapable of changing the disposition.
 */
export async function maybeBuildReferral(
  trace: AdjudicationTrace,
  lang: Lang,
  deps?: ReferralDeps,
): Promise<ReferralView | null> {
  // Emergency-first: only the allowlisted non-emergency dispositions get a referral.
  if (!isReferralEligible(trace.decision.action)) return null;
  // No RAG wired (local / no embedding key) → silently skip. The disposition stands alone.
  if (!deps) return null;

  const language = toResourceLanguage(lang);
  const query = buildReferralQuery(trace.evidence, trace.riskEstimate.reasonCodes);

  let citations: ReferralCitation[] = [];
  try {
    citations = await deps.retrieve({
      tenantId: deps.tenantId,
      query,
      language,
      topK: deps.topK ?? 1,
    });
  } catch {
    // Embedding key missing, store error, network — referral is optional decoration. Skip, never error.
    return null;
  }

  const min = deps.minScore ?? 0;
  const usable = citations.filter((c) => c.score >= min);
  if (usable.length === 0) return null;

  // buildReferralBlock is from lib/rag: it echoes the decided action for copy and returns the
  // bilingual advisory note + citations. It has no engine import and cannot compute an action.
  const block = buildReferralBlock({
    decidedAction: trace.decision.action,
    citations: usable,
    language,
  });
  return {
    decidedAction: block.decidedAction,
    citations: block.citations,
    advisoryNote: block.advisoryNote,
  };
}
