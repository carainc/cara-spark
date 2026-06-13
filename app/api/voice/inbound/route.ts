/**
 * POST /api/voice/inbound — inbound DID → agent routing (tk-0023).
 *
 * When a call arrives at the standalone SIP trunk, the SIP/Telnyx side posts the inbound event.
 * We pull the CALLED number (the DID the caller dialed — `to`/`destination`, NOT the caller's
 * own number), resolve the owning PUBLISHED agent, and return that agent's explicit SIP dispatch
 * plan (workerName + room prefix) so the call is dispatched to the right worker
 * (room_config.agents=[workerName]).
 *
 * FAIL CLOSED: if no unique PUBLISHED agent owns the dialed DID, we return 404 with NO dispatch
 * plan. The caller (the SIP integration) must reject / route to a safe default — we never emit a
 * dispatch to a wrong, draft, or phone-disabled agent.
 *
 * NO PHI: the DID is routing metadata. We never log it raw and never echo the caller's number.
 * PROD ISOLATION: this is app-side routing only — it reads our Postgres and mints the SAME
 * deterministic dispatch identity the gateway uses; it never touches the prod LiveKit/Telnyx IDs.
 *
 * Auth: the SIP integration presents a worker bearer token (HMAC, VOICE_CONFIG_HMAC_SECRET),
 * bound to the inbound call/session id — fail-closed, same scheme as decide/post-call.
 * Node runtime required (HMAC via node:crypto).
 */
import { prisma } from '@/lib/db';
import { resolveAgentByDid, safeRoutingLog } from '@/lib/voice/routing';
import { authorizeWorker } from '../_auth';

export const runtime = 'nodejs';

/**
 * A permissive view of the inbound SIP/Telnyx payload. Different providers nest the dialed
 * number differently; we look in the common places. We deliberately do NOT type the caller's
 * number — we never read it (no PHI beyond routing).
 */
interface InboundPayload {
  /** A stable id for THIS inbound call/session — the token is bound to it. */
  callId?: string;
  sessionId?: string;
  call_control_id?: string;
  /** The dialed DID in various provider shapes. */
  to?: string;
  destination?: string;
  destination_number?: string;
  called?: string;
  calledNumber?: string;
  data?: { payload?: { to?: string; destination_number?: string } };
}

/** Pull the per-call session id the bearer token is bound to. */
function sessionIdOf(p: InboundPayload): string | null {
  return p.callId || p.sessionId || p.call_control_id || null;
}

/** Pull the CALLED DID (what the caller dialed) from the common provider shapes. Never the caller. */
function dialedDidOf(p: InboundPayload): string | null {
  return (
    p.to ||
    p.destination ||
    p.destination_number ||
    p.called ||
    p.calledNumber ||
    p.data?.payload?.to ||
    p.data?.payload?.destination_number ||
    null
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: InboundPayload;
  try {
    body = (await req.json()) as InboundPayload;
  } catch {
    return Response.json({ matched: false, error: 'invalid json' }, { status: 400 });
  }

  const sessionId = sessionIdOf(body);
  if (!sessionId) {
    return Response.json({ matched: false, error: 'missing call/session id' }, { status: 400 });
  }

  // Worker/integration auth bound to the inbound call id. Fail-closed before any lookup.
  if (!authorizeWorker(req, sessionId)) {
    return Response.json({ matched: false, error: 'unauthorized' }, { status: 401 });
  }

  const did = dialedDidOf(body);
  const result = await resolveAgentByDid(prisma, did);

  // Structural, no-PHI breadcrumb — never the dialed number itself.
  // eslint-disable-next-line no-console
  console.log('[voice] inbound route', safeRoutingLog(result));

  if (!result.matched) {
    // FAIL CLOSED: no dispatch plan. The SIP side must reject / route to a safe default.
    return Response.json(
      { matched: false, reason: result.reason },
      // 400 when the payload carried no usable DID; 404 when nothing/ambiguous owns it.
      { status: result.reason === 'no_did' ? 400 : 404 },
    );
  }

  // The resolved explicit-dispatch plan: which worker answers + the room prefix it filters on.
  return Response.json(
    {
      matched: true,
      agentId: result.agentId,
      workerName: result.workerName,
      dispatchName: result.dispatchName,
      roomPrefix: result.plan.roomPrefix,
      attributes: result.plan.attributes,
    },
    { status: 200 },
  );
}
