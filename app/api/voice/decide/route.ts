/**
 * POST /api/voice/decide — the no-PHI, mid-call policy decision the agent-worker calls before it
 * may respond. Body is a `VoicePolicyDecisionRequest` (model-proposed evidence + risk + the OPAQUE
 * identity — never raw PHI). The DETERMINISTIC engine decides the action; we return policy-authored
 * bilingual guidance. The model can never soften it.
 *
 * Auth: the worker presents a bearer token bound to the callId (HMAC, VOICE_CONFIG_HMAC_SECRET).
 * Node runtime required (HMAC via node:crypto).
 */
import { getVoiceGateway } from '@/lib/voice';
import type { VoicePolicyDecisionRequest } from '@/lib/voice/types';
import { authorizeWorker } from '../_auth';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: VoicePolicyDecisionRequest;
  try {
    body = (await req.json()) as VoicePolicyDecisionRequest;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body?.callId || !body?.agentId || !Array.isArray(body?.evidence) || !body?.riskEstimate) {
    return Response.json({ error: 'missing required fields' }, { status: 400 });
  }

  // Worker auth is bound to the callId (the per-call session id).
  if (!authorizeWorker(req, body.callId)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const decision = await getVoiceGateway().decide(body);
    return Response.json(decision, { status: 200 });
  } catch (err) {
    // The engine throws NotImplemented until T1 lands. Fail CLOSED to the safest handoff so a
    // live call never proceeds ungated. (No PHI — message is the engine symbol only.)
    const message = err instanceof Error ? err.message : 'decision failed';
    return Response.json(
      { error: 'engine_unavailable', detail: message, failClosed: 'BLOCK_AND_HUMAN_HANDOFF' },
      { status: 503 },
    );
  }
}
