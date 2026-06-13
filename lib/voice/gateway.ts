/**
 * VoiceGateway — the standalone-LiveKit (T13) implementation of the frozen voice port
 * (lib/voice/types.ts). It is the app's side of the model-proposes / engine-decides split:
 *
 *   • registerAgent  — explicit SIP dispatch. The worker registers `workerName`; the dispatch
 *                      rule sets room_config.agents=[workerName]. We VERIFY the HMAC config
 *                      signature first (tamper-evident) and only then create the dispatch.
 *   • decide         — the no-PHI mid-call policy decision. Resolves the agent's verified policy
 *                      bundle and calls the DETERMINISTIC engine (`@/engine` adjudicate). The
 *                      ENGINE decides the action; we attach policy-authored, bilingual guidance.
 *                      Identity is the opaque ref ONLY — never raw PHI.
 *   • postCallResult — drops the final disposition + provable trace into the review queue + audit
 *                      trail (T11). No raw transcript PHI.
 *
 * The LiveKit dispatch + the review-queue sink are injected seams (LiveKitDispatcher /
 * ReviewQueueSink) so this is unit-testable and never hard-binds the prod stack. The default
 * dispatcher targets the STANDALONE LiveKit via env (LIVEKIT_URL/KEY/SECRET) — never the prod
 * cara-realtime stack.
 *
 * NOTE: imports the engine SYNC `adjudicate`; it throws NotImplemented until T1 lands. Wiring is
 * correct so it works the moment T1 ships. `decide` surfaces a clear, fail-closed error today.
 */
import { adjudicate, type AdjudicateInput } from '@/engine';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';
import type { PolicyBundle } from '@/engine/types';
import type {
  PostCallResult,
  VoiceAgentRegistration,
  VoiceGateway,
  VoicePolicyDecisionRequest,
  VoicePolicyDecisionResponse,
} from './types';
import { verifyConfig, VOICE_CONFIG_HMAC_ENV, type SignableVoiceConfig } from './config-signature';
import { guidanceFor } from './guidance';
import { safeDecisionLog, safeDecisionResultLog, safePostCallLog } from './redact';

/** Builds the LiveKit explicit-dispatch room config for an agent. */
export interface DispatchPlan {
  /** The single named agent for the room: room_config.agents = [workerName]. */
  workerName: string;
  /** Room name prefix the SIP dispatch rule mints (worker filters on it). */
  roomPrefix: string;
  /** Dispatch-rule attributes the worker reads (opaque agent ref + language). No PHI. */
  attributes: { agentId: string; agentName: string; language: string };
}

/**
 * Creates / upserts the explicit SIP dispatch against the STANDALONE LiveKit. Implementations
 * call LiveKit's SIP API (CreateSIPDispatchRule with room_config.agents=[workerName]). The
 * default no-op dispatcher lets the app boot + tests run without a live LiveKit; a real
 * dispatcher is wired where LIVEKIT_URL points at the standalone server.
 */
export interface LiveKitDispatcher {
  upsertDispatch(plan: DispatchPlan): Promise<{ dispatchName: string }>;
}

/** Persists a post-call result to the review queue + audit trail (T11 owns the store). */
export interface ReviewQueueSink {
  enqueue(result: PostCallResult): Promise<void>;
}

/** Default dispatcher: no live call — returns the deterministic dispatch name. Logs structurally. */
const defaultDispatcher: LiveKitDispatcher = {
  async upsertDispatch(plan) {
    // A real impl POSTs CreateSIPDispatchRule to LIVEKIT_URL with room_config.agents=[workerName].
    // Here we just echo the dispatch identity so registration is deterministic + offline-testable.
    return { dispatchName: plan.workerName };
  },
};

/** Default review sink: structured no-PHI log. T11 swaps in the DB-backed AuditEntry/Call writer. */
const defaultReviewSink: ReviewQueueSink = {
  async enqueue(result) {
    // eslint-disable-next-line no-console
    console.log('[voice] post-call → review queue', safePostCallLog(result));
  },
};

export interface VoiceGatewayDeps {
  dispatcher?: LiveKitDispatcher;
  reviewSink?: ReviewQueueSink;
  /** Resolve the VERIFIED policy bundle for a version. Defaults to the engine DEFAULT_POLICY. */
  resolveBundle?: (policyBundleVersion: string) => PolicyBundle;
  /** HMAC secret; defaults to process.env[VOICE_CONFIG_HMAC_SECRET]. */
  hmacSecret?: string;
}

export class StandaloneVoiceGateway implements VoiceGateway {
  private readonly dispatcher: LiveKitDispatcher;
  private readonly reviewSink: ReviewQueueSink;
  private readonly resolveBundle: (v: string) => PolicyBundle;
  private readonly hmacSecret: string | undefined;

  constructor(deps: VoiceGatewayDeps = {}) {
    this.dispatcher = deps.dispatcher ?? defaultDispatcher;
    this.reviewSink = deps.reviewSink ?? defaultReviewSink;
    // T2 will resolve signed bundles by version; until then every version maps to DEFAULT_POLICY.
    this.resolveBundle = deps.resolveBundle ?? (() => DEFAULT_POLICY);
    this.hmacSecret = deps.hmacSecret ?? process.env[VOICE_CONFIG_HMAC_ENV];
  }

  /**
   * Register an agent for explicit SIP dispatch. The registration's HMAC signature is verified
   * against VOICE_CONFIG_HMAC_SECRET BEFORE any dispatch is created — fail-closed on tamper.
   */
  async registerAgent(
    reg: VoiceAgentRegistration,
  ): Promise<{ ok: boolean; dispatchName: string }> {
    const signable: SignableVoiceConfig = {
      agentId: reg.agentId,
      agentName: reg.agentName,
      workerName: reg.workerName,
      language: reg.language,
      policyBundleVersion: reg.policyBundleVersion,
    };
    if (!verifyConfig(signable, reg.configSignature, this.hmacSecret)) {
      // Do NOT create a dispatch for an unsigned / tampered config.
      return { ok: false, dispatchName: '' };
    }

    const plan: DispatchPlan = {
      workerName: reg.workerName,
      roomPrefix: `voicephone-${reg.agentId}-`,
      attributes: { agentId: reg.agentId, agentName: reg.agentName, language: reg.language },
    };
    const { dispatchName } = await this.dispatcher.upsertDispatch(plan);
    return { ok: true, dispatchName };
  }

  /**
   * The no-PHI mid-call decision. We forward ONLY model-proposed evidence + risk + the opaque
   * identity to the DETERMINISTIC engine. The engine returns the action; we never let the model
   * choose it. Guidance is policy-authored, bilingual, and verbatim.
   */
  async decide(req: VoicePolicyDecisionRequest): Promise<VoicePolicyDecisionResponse> {
    // Structural, PHI-free audit breadcrumb (never the raw payload).
    // eslint-disable-next-line no-console
    console.log('[voice] decide', safeDecisionLog(req));

    // The frozen decision request does not carry a bundle version (it's set at registration);
    // resolve against the engine default version. T2 wires per-agent signed-bundle lookup here.
    const bundle = this.resolveBundle(DEFAULT_POLICY.metadata.policyVersion);

    const input: AdjudicateInput = {
      evidence: req.evidence,
      riskEstimate: req.riskEstimate,
      bundle,
      // workflowState defaults to COLLECTING_EVIDENCE → ADJUDICATING in the engine.
    };

    // DETERMINISTIC adjudication (sync). The engine — not the model — picks the action.
    const trace = adjudicate(input);
    const action = trace.decision.action;

    const res: VoicePolicyDecisionResponse = {
      action,
      // Policy-authored, in the call language. The model cannot soften this.
      guidance: guidanceFor(action, req.language),
      trace,
    };
    // eslint-disable-next-line no-console
    console.log('[voice] decide →', safeDecisionResultLog(res));
    return res;
  }

  /** Final disposition + provable trace → review queue + audit trail (T11). No transcript PHI. */
  async postCallResult(result: PostCallResult): Promise<{ ok: boolean }> {
    await this.reviewSink.enqueue(result);
    return { ok: true };
  }
}

/** Convenience singleton for the API routes (constructed lazily from env). */
let _gateway: StandaloneVoiceGateway | null = null;
export function getVoiceGateway(deps?: VoiceGatewayDeps): StandaloneVoiceGateway {
  if (deps) return new StandaloneVoiceGateway(deps);
  if (!_gateway) _gateway = new StandaloneVoiceGateway();
  return _gateway;
}
