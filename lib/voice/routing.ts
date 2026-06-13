/**
 * Inbound DID → agent routing (tk-0023).
 *
 * Lane G built EXPLICIT SIP dispatch (a call → one agent's worker by `workerName`;
 * room_config.agents=[workerName]). What was missing is the lookup that turns an INBOUND
 * called-number (the DID the caller dialed, from the SIP/Telnyx payload) into the OWNING
 * agent and therefore its dispatch plan. This module is that lookup — multi-number routing
 * on top of the single-DID dispatch.
 *
 * Law of this module:
 *
 *   • FAIL CLOSED. If we cannot resolve a unique PUBLISHED agent with an ENABLED PHONE
 *     channel whose number matches the dialed DID, we return `{ matched: false }`. The
 *     inbound route must then reject / route to a safe default — we NEVER mis-route a call to
 *     a wrong, draft, or phone-disabled agent.
 *
 *   • NO PHI. The dialed DID is a phone number — routing metadata, not clinical content. We
 *     match on it but NEVER log it raw and NEVER put it in model context. `safeRoutingLog`
 *     projects a resolution to a structural, value-free shape for breadcrumbs.
 *
 *   • PROD ISOLATION. This is app-side routing logic only. It reads our own Postgres
 *     (Agent/Channel — frozen schema) and mints the SAME deterministic dispatch identity the
 *     gateway uses. It NEVER touches the prod LiveKit/Telnyx IDs.
 *
 * This is decision-inert: it picks WHICH agent answers, never WHAT the agent decides (the
 * deterministic engine owns dispositions).
 */
import type { AgentStatus, ChannelKind } from '@prisma/client';
import type { DispatchPlan } from './gateway';

/**
 * Normalize a dialed number to a canonical E.164-ish form so `+14157180498`, `14157180498`,
 * `(415) 718-0498`, and `415-718-0498` all match the one stored DID.
 *
 * Rules (intentionally small + deterministic — this is routing, not validation):
 *   • strip everything that isn't a digit or a leading `+`
 *   • a `+` prefix is authoritative (already E.164) → keep digits as-is
 *   • a bare 11-digit `1XXXXXXXXXX` → assume NANP, prefix `+`
 *   • a bare 10-digit `XXXXXXXXXX`  → assume NANP, prefix `+1`
 *   • anything else with digits     → prefix `+` and keep (best-effort international)
 *
 * Returns `null` for input with no usable digits — which fails routing closed upstream.
 * NOTE: we never assume a default country for non-NANP-shaped numbers beyond adding `+`; the
 * stored DID is the source of truth and stored normalized the same way.
 */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hadPlus) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/**
 * The common surface forms a single DID might be STORED as, derived from its normalized E.164.
 * The DB `phoneNumber` column is plain text and a row could have been written non-normalized
 * (e.g. `14157180498` or `4157180498`). We use this set as a `phoneNumber: { in: [...] }`
 * pre-filter so the query is not defeated by storage form — then `resolveAgentByDid` does the
 * authoritative normalize re-check in-process. Always includes the normalized form itself.
 */
export function equivalentDialForms(normalized: string): string[] {
  const forms = new Set<string>([normalized]);
  const digits = normalized.replace(/\D/g, '');
  // bare digits (no +), e.g. 14157180498
  forms.add(digits);
  // NANP: also the 10-digit national form (drop the leading country-code 1)
  if (digits.length === 11 && digits.startsWith('1')) forms.add(digits.slice(1));
  return [...forms];
}

/** A PHONE channel slice we read for routing. `config` may carry a registered worker name. */
export interface RoutableChannel {
  kind: ChannelKind;
  enabled: boolean;
  phoneNumber: string | null;
  /** Channel.config (Json?) — registration may stash `{ workerName }` here. No PHI. */
  config: unknown;
}

/** A PUBLISHED agent slice + its channels, as routing reads it. */
export interface RoutableAgent {
  id: string;
  name: string;
  slug: string;
  status: AgentStatus;
  language: string;
  channels: RoutableChannel[];
}

/**
 * Narrow structural slice of PrismaClient used by routing. Arg AND return types are loose (`any`)
 * so both the real `PrismaClient` (whose `findMany` row type does not statically carry the
 * runtime `include: { channels: true }`) and a test mock satisfy it. `resolveAgentByDid` narrows
 * the result to `RoutableAgent` internally and re-checks every field it relies on, so the loose
 * boundary never weakens the actual matching. Mirrors the `AgentPrisma` convention in
 * lib/auth/agents.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RoutingPrisma {
  agent: {
    findMany(args: { where: any; include?: any }): Promise<any[]>;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The dispatch identity the gateway uses, plus the resolved agent's routing facts. */
export interface ResolvedDispatch {
  matched: true;
  agentId: string;
  agentName: string;
  language: string;
  /** The explicit named worker for the room: room_config.agents = [workerName]. */
  workerName: string;
  /** The LiveKit dispatch name (deterministically = workerName, mirroring the gateway). */
  dispatchName: string;
  /** The full dispatch plan, byte-for-byte the shape the gateway mints at registration. */
  plan: DispatchPlan;
}

/** Fail-closed result — the inbound route must reject / route to a safe default on this. */
export interface UnresolvedDispatch {
  matched: false;
  /** Why we refused, for a structural (no-PHI) breadcrumb. Never includes the DID. */
  reason: 'no_did' | 'no_match' | 'ambiguous';
}

export type RoutingResult = ResolvedDispatch | UnresolvedDispatch;

/** The room-name prefix the SIP dispatch rule mints — IDENTICAL to the gateway's. */
export function roomPrefixFor(agentId: string): string {
  return `voicephone-${agentId}-`;
}

/**
 * The worker name for an agent at INBOUND-resolve time.
 *
 * Frozen-contract friction: `VoiceAgentRegistration.workerName` is supplied EXTERNALLY at
 * registration and is not a column on the frozen Agent/Channel schema. So routing resolves it
 * in priority order, without touching the frozen schema:
 *
 *   1. the PHONE channel's `config.workerName`, if registration stashed it there (Channel.config
 *      is an existing `Json?` field — no schema change), else
 *   2. a deterministic fallback derived from the agent slug: `cara-spark-<slug>` — stable, and
 *      matches the `cara-spark-*` worker naming the gateway tests use.
 *
 * Either way the result is deterministic, so the inbound dispatch name lines up with the
 * worker the registration created.
 */
export function workerNameForAgent(agent: RoutableAgent, phoneChannel: RoutableChannel): string {
  const fromConfig = readWorkerNameFromConfig(phoneChannel.config);
  if (fromConfig) return fromConfig;
  return `cara-spark-${agent.slug}`;
}

/** Read a `workerName` string out of an opaque Channel.config blob. No PHI; routing only. */
function readWorkerNameFromConfig(config: unknown): string | null {
  if (config && typeof config === 'object' && 'workerName' in config) {
    const wn = (config as { workerName?: unknown }).workerName;
    if (typeof wn === 'string' && wn.trim().length > 0) return wn.trim();
  }
  return null;
}

/**
 * Resolve the dialed DID → the owning PUBLISHED agent → its dispatch plan.
 *
 * Steps:
 *   1. Normalize the dialed number to E.164. No digits → fail closed (`no_did`).
 *   2. Query only PUBLISHED agents that have an ENABLED PHONE channel matching the normalized
 *      DID. We additionally re-check the match in-process against the normalized stored number
 *      so a DID persisted in a different surface form (e.g. `14157180498` vs `+14157180498`)
 *      still matches and a non-normalized DB value can never slip a wrong agent through.
 *   3. Exactly one match → return the dispatch. Zero → `no_match`. More than one → `ambiguous`
 *      (a misconfiguration; we refuse rather than guess — fail closed, never mis-route).
 *
 * The DID is NEVER logged raw and is NEVER returned in the resolved payload (no PHI leakage of
 * routing metadata beyond what the caller already holds).
 */
export async function resolveAgentByDid(prisma: RoutingPrisma, did: string | null | undefined): Promise<RoutingResult> {
  const normalized = normalizeE164(did);
  if (!normalized) return { matched: false, reason: 'no_did' };

  // Pre-filter to the obvious candidates: PUBLISHED agents with an enabled PHONE channel whose
  // stored number is one of the equivalent surface forms of the dialed DID. `{ in: [...] }` (not
  // a bare `=`) so a non-normalized stored value (e.g. `14157180498`) is not missed. The
  // in-process re-check below is still the authority.
  const candidates: RoutableAgent[] = await prisma.agent.findMany({
    where: {
      status: 'PUBLISHED',
      channels: { some: { kind: 'PHONE', enabled: true, phoneNumber: { in: equivalentDialForms(normalized) } } },
    },
    include: { channels: true },
  });

  // In-process safety re-check: only PHONE + enabled channels whose NORMALIZED stored number
  // equals the normalized DID count. This makes the match independent of how the DID was stored
  // and guarantees a disabled/non-PHONE channel can never satisfy the match.
  const matches: ResolvedDispatch[] = [];
  for (const agent of candidates) {
    if (agent.status !== 'PUBLISHED') continue; // defensive: never trust a loose mock/where
    const phone = agent.channels.find(
      (c) => c.kind === 'PHONE' && c.enabled && normalizeE164(c.phoneNumber) === normalized,
    );
    if (!phone) continue;
    const workerName = workerNameForAgent(agent, phone);
    const plan: DispatchPlan = {
      workerName,
      roomPrefix: roomPrefixFor(agent.id),
      attributes: { agentId: agent.id, agentName: agent.name, language: agent.language },
    };
    matches.push({
      matched: true,
      agentId: agent.id,
      agentName: agent.name,
      language: agent.language,
      workerName,
      dispatchName: workerName, // gateway: dispatchName === workerName
      plan,
    });
  }

  if (matches.length === 0) return { matched: false, reason: 'no_match' };
  if (matches.length > 1) return { matched: false, reason: 'ambiguous' };
  return matches[0];
}

/**
 * Structural, PHI-free projection of a routing resolution for a breadcrumb. NEVER includes the
 * dialed DID or the stored number — only the matched/agent identity + reason. This is the ONLY
 * routing shape that should reach a log line.
 */
export function safeRoutingLog(result: RoutingResult) {
  if (result.matched) {
    return {
      matched: true,
      agentId: result.agentId,
      workerName: result.workerName,
      language: result.language,
    } as const;
  }
  return { matched: false, reason: result.reason } as const;
}
