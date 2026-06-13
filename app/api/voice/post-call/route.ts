/**
 * POST /api/voice/post-call — the agent-worker posts the final result when a call ends. Body is a
 * `PostCallResult` (frozen contract): the final deterministic disposition + the provable trace +
 * an optional reference to a redacted/synthetic transcript store. NEVER raw transcript PHI.
 * The gateway drops it into the review queue + audit trail (T11).
 *
 * Auth: worker bearer token bound to the callId. Node runtime required (HMAC via node:crypto).
 */
import { getVoiceGateway } from '@/lib/voice';
import type { PostCallResult } from '@/lib/voice/types';
import { authorizeWorker } from '../_auth';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: PostCallResult;
  try {
    body = (await req.json()) as PostCallResult;
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  if (!body?.callId || !body?.agentId || !body?.disposition || !body?.trace) {
    return Response.json({ ok: false, error: 'missing required fields' }, { status: 400 });
  }

  if (!authorizeWorker(req, body.callId)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const result = await getVoiceGateway().postCallResult(body);
  return Response.json(result, { status: 200 });
}
