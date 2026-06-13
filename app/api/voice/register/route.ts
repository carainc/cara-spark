/**
 * POST /api/voice/register — register an agent for explicit SIP dispatch against the standalone
 * LiveKit (T13). Body is a `VoiceAgentRegistration` (frozen contract). The gateway verifies the
 * HMAC config signature before creating any dispatch (fail-closed on tamper). No PHI here.
 *
 * Node runtime required (HMAC via node:crypto).
 */
import { getVoiceGateway } from '@/lib/voice';
import type { VoiceAgentRegistration } from '@/lib/voice/types';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: VoiceAgentRegistration;
  try {
    body = (await req.json()) as VoiceAgentRegistration;
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  if (!body?.agentId || !body?.workerName || !body?.configSignature) {
    return Response.json({ ok: false, error: 'missing required fields' }, { status: 400 });
  }

  const result = await getVoiceGateway().registerAgent(body);
  // 403 when the signature fails — the dispatch was refused.
  return Response.json(result, { status: result.ok ? 200 : 403 });
}
