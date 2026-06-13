/**
 * KioskSessionBridge (T16 / CAR-2395) — the kiosk's side of the model-proposes / engine-decides
 * split. It is DELIBERATELY THIN: it adds NO triage logic. It adapts a one-button device's spoken
 * turn into the SAME agent loop the chat + voice lanes use (`runTurn` from lib/agent/loop.ts),
 * then renders the engine's binding decision as spoken, bilingual guidance.
 *
 *   utterance ─► runTurn() ─► { trace, panel, assistantText }
 *                  │  MODEL proposes typed evidence (Opus 4.8) ─► ENGINE decides the action
 *                  └─ identity is ALWAYS the unverified (model-blind) block — kiosks are anonymous
 *   ─► spokenGuidance(trace.decision.action, lang)  [policy-authored, verbatim — model can't soften]
 *
 * ANONYMOUS / model-blind: the bridge constructs `unverifiedIdentity()` itself and never accepts a
 * raw identifier — the kiosk population (houseless, no phone, no account) has none and must never be
 * asked for one. The model payload therefore carries only the opaque { verified:false, opaqueRef:'' }.
 *
 * The single model call (`createMessage`) is injected, exactly like the loop — so vitest mocks it
 * with zero network. Persistence is an injected, optional sink (Lane F `recordCall`, channel=KIOSK):
 * the bridge never imports Prisma, so it stays unit-testable and never hard-binds the DB.
 */
import { randomBytes } from 'node:crypto';
import { runTurn, type CreateMessage } from '@/lib/agent/loop';
import type { AdjudicationTrace } from '@/engine/types';
import type { PolicyBundle } from '@/engine/types';
import { unverifiedIdentity } from '@/lib/identity/types';
import { toModelIdentityContext } from '@/lib/identity/model-context';
import type { KioskSessionRequest, KioskSessionResponse } from './types';
import { isKioskEscalation, spokenGuidance } from './spoken';
import { safeKioskRequestLog, safeKioskResultLog } from './redact';

/** Human-skimmable namespace for an ephemeral kiosk session ref — carries no PHI (CSPRNG only). */
export const KIOSK_SESSION_PREFIX = 'kss_';

/** Mint a fresh, opaque, ephemeral session ref. Derived from CSPRNG bytes only — never any input. */
export function mintSessionRef(): string {
  return `${KIOSK_SESSION_PREFIX}${randomBytes(12).toString('base64url')}`;
}

/**
 * Optional persistence sink — Lane F's `recordCall` shape, narrowed to what the kiosk needs. The
 * bridge calls it (when provided) with channel='KIOSK' so a kiosk session lands in the same no-PHI
 * audit trail as chat/voice. Injected to avoid a hard Prisma import here.
 */
export interface KioskAuditSink {
  record(input: {
    agentId: string;
    channel: 'KIOSK';
    language: 'EN' | 'ES';
    /** Opaque, ephemeral session handle — PHI-free. */
    identityRef: string;
    traces: AdjudicationTrace[];
  }): Promise<void>;
}

export interface KioskSessionDeps {
  /** The injected single model call. The real route wires `defaultCreateMessage()` (BYO key). */
  createMessage: CreateMessage;
  /** Optional verified policy bundle; defaults to the engine DEFAULT_POLICY inside the loop. */
  bundle?: PolicyBundle;
  /** Optional no-PHI audit sink (Lane F recordCall, channel=KIOSK). Skipped if absent. */
  audit?: KioskAuditSink;
  /** Test/observability hook for the structural no-PHI log line. Defaults to console.log. */
  log?: (label: string, payload: unknown) => void;
}

/**
 * Run ONE kiosk turn end-to-end through the shared loop. Anonymous + model-blind by construction.
 * Returns the spoken, bilingual, policy-authored guidance the device plays out loud.
 */
export async function runKioskSession(
  req: KioskSessionRequest,
  deps: KioskSessionDeps,
): Promise<KioskSessionResponse> {
  const log = deps.log ?? ((label, payload) => console.log(label, payload));
  log('[kiosk] session', safeKioskRequestLog(req));

  const sessionRef = req.sessionRef && req.sessionRef.length > 0 ? req.sessionRef : mintSessionRef();

  // ANONYMOUS: identity is ALWAYS the unverified, model-blind block. The kiosk never collects, and
  // the bridge never accepts, an identifier — so the model payload carries no PHI, by construction.
  const identity = toModelIdentityContext(unverifiedIdentity());

  // REUSE THE LOOP: model proposes typed evidence → engine decides. No triage logic lives here.
  const { trace } = await runTurn({
    createMessage: deps.createMessage,
    lang: req.lang,
    identity,
    history: [{ role: 'user', text: req.utterance }],
    bundle: deps.bundle,
    traceId: sessionRef,
  });

  const action = trace.decision.action;
  const res: KioskSessionResponse = {
    sessionRef,
    action,
    // Policy-authored, TTS-shaped, in the caller's language. The model cannot soften this.
    spoken: spokenGuidance(action, req.lang),
    isEscalation: isKioskEscalation(action),
    trace,
  };

  // No-PHI audit (Lane F), if a sink is wired. Identity is the opaque session ref only.
  if (deps.audit) {
    await deps.audit.record({
      agentId: req.agentId,
      channel: 'KIOSK',
      language: req.lang === 'es' ? 'ES' : 'EN',
      identityRef: sessionRef,
      traces: [trace],
    });
  }

  log('[kiosk] session →', safeKioskResultLog(res));
  return res;
}
