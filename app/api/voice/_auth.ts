/**
 * Worker→app auth for the voice API routes. The agent-worker mints a bearer token
 * (`cara-voicecfg-v1.<nonce>.<sig>`, HMAC-SHA256 over the room/session id) which we verify here.
 * Fail-closed: missing/secret-less/forged token → unauthorized. No PHI is read or logged.
 */
import { verifyWorkerToken } from '@/lib/voice/config-signature';

/** Extract a Bearer token from the Authorization header. */
function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * Authorize a worker call for a given session/room id (the callId is the session binding).
 * Returns true only when the token verifies against VOICE_CONFIG_HMAC_SECRET.
 */
export function authorizeWorker(req: Request, sessionId: string): boolean {
  const token = bearer(req);
  if (!token) return false;
  return verifyWorkerToken(token, sessionId, process.env.VOICE_CONFIG_HMAC_SECRET);
}
