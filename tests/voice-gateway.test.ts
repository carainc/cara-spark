/**
 * VoiceGateway behavior (Lane G). Covers the parts that do NOT depend on the engine impl:
 *   • registerAgent verifies the HMAC config signature BEFORE creating any dispatch (fail-closed),
 *     and the dispatch is the explicit named worker (room_config.agents=[workerName] semantics).
 *   • postCallResult routes to the review-queue sink.
 *   • decide is wired to the deterministic engine and fails CLOSED (propagates) while the engine is
 *     NotImplemented (pre-T1) — proving the worker never proceeds ungated.
 * No network, no real call.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  StandaloneVoiceGateway,
  type LiveKitDispatcher,
  type ReviewQueueSink,
  type DispatchPlan,
} from '@/lib/voice/gateway';
import { signConfig, type SignableVoiceConfig } from '@/lib/voice/config-signature';
import type { VoiceAgentRegistration, PostCallResult, VoicePolicyDecisionRequest } from '@/lib/voice/types';
import type { AdjudicationTrace, EvidenceFact, RiskEstimate } from '@/engine/types';

const SECRET = 'gateway-unit-secret';

function makeRegistration(over: Partial<VoiceAgentRegistration> = {}): VoiceAgentRegistration {
  const base = {
    agentId: 'agent-1',
    agentName: 'Front Desk',
    workerName: 'cara-spark-cascade',
    language: 'en' as const,
    policyBundleVersion: 'default-0.1.0',
  };
  const signable: SignableVoiceConfig = { ...base };
  return { ...base, configSignature: signConfig(signable, SECRET), ...over };
}

describe('registerAgent — HMAC gate + explicit dispatch', () => {
  it('creates an explicit named dispatch when the signature is valid', async () => {
    const captured: DispatchPlan[] = [];
    const dispatcher: LiveKitDispatcher = {
      async upsertDispatch(plan) {
        captured.push(plan);
        return { dispatchName: plan.workerName };
      },
    };
    const gw = new StandaloneVoiceGateway({ dispatcher, hmacSecret: SECRET });

    const res = await gw.registerAgent(makeRegistration());

    expect(res.ok).toBe(true);
    expect(res.dispatchName).toBe('cara-spark-cascade'); // worker registers THIS name
    expect(captured).toHaveLength(1);
    // explicit dispatch: room_config.agents = [workerName]; worker filters on the room prefix
    expect(captured[0].workerName).toBe('cara-spark-cascade');
    expect(captured[0].roomPrefix).toBe('voicephone-agent-1-');
    expect(captured[0].attributes).toEqual({
      agentId: 'agent-1',
      agentName: 'Front Desk',
      language: 'en',
    });
  });

  it('REFUSES to create a dispatch when the signature is tampered (fail-closed)', async () => {
    const dispatcher: LiveKitDispatcher = { upsertDispatch: vi.fn(async (p) => ({ dispatchName: p.workerName })) };
    const gw = new StandaloneVoiceGateway({ dispatcher, hmacSecret: SECRET });

    // valid signature, but mutate workerName to the PROD name after signing
    const reg = makeRegistration({ workerName: 'cara-realtime' });
    const res = await gw.registerAgent(reg);

    expect(res.ok).toBe(false);
    expect(res.dispatchName).toBe('');
    expect(dispatcher.upsertDispatch).not.toHaveBeenCalled();
  });

  it('REFUSES when no HMAC secret is configured', async () => {
    const dispatcher: LiveKitDispatcher = { upsertDispatch: vi.fn(async (p) => ({ dispatchName: p.workerName })) };
    const gw = new StandaloneVoiceGateway({ dispatcher, hmacSecret: undefined });
    const res = await gw.registerAgent(makeRegistration());
    expect(res.ok).toBe(false);
    expect(dispatcher.upsertDispatch).not.toHaveBeenCalled();
  });
});

describe('postCallResult — review queue', () => {
  it('routes the result to the review-queue sink', async () => {
    const enqueued: PostCallResult[] = [];
    const reviewSink: ReviewQueueSink = {
      async enqueue(r) {
        enqueued.push(r);
      },
    };
    const gw = new StandaloneVoiceGateway({ reviewSink, hmacSecret: SECRET });
    const result: PostCallResult = {
      callId: 'voicephone-agent-1-room',
      agentId: 'agent-1',
      language: 'en',
      startedAt: '2026-06-13T00:00:00.000Z',
      endedAt: '2026-06-13T00:01:00.000Z',
      disposition: 'ROUTINE_REVIEW',
      trace: { traceId: 'tr-1' } as unknown as AdjudicationTrace,
    };
    const res = await gw.postCallResult(result);
    expect(res.ok).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].disposition).toBe('ROUTINE_REVIEW');
  });
});

describe('decide — wired to the deterministic engine (engine decides)', () => {
  it('resolves with the engine deterministic disposition + trace (model proposes, engine decides)', async () => {
    const gw = new StandaloneVoiceGateway({ hmacSecret: SECRET });
    const evidence: EvidenceFact[] = [];
    const riskEstimate: RiskEstimate = {
      pRoutine: 0.5,
      pUrgent: 0.3,
      pCritical: 0.2,
      confidence: 0.5,
      oodScore: 0.2,
      evidenceCoverageScore: 0.5,
      reasonCodes: [],
      modelVersion: 'test',
    };
    const req: VoicePolicyDecisionRequest = {
      agentId: 'agent-1',
      callId: 'room',
      language: 'en',
      identity: { verified: false, opaqueRef: '' },
      evidence,
      riskEstimate,
    };
    // Post-T1: the engine adjudicates this proposal → ROUTINE_REVIEW (no red flag fired; confidence
    // 0.5 is below the self-care threshold). decide RESOLVES with the engine's decision + a provable
    // trace + bilingual guidance — the worker never picks a disposition itself.
    const res = await gw.decide(req);
    expect(res.action).toBe('ROUTINE_REVIEW');
    expect(res.trace).toBeTruthy();
    expect(res.guidance).toBeTruthy();
  });
});
