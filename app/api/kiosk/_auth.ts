/**
 * Device-token auth for the kiosk API route. A kiosk box presents its long-lived, revocable
 * DEVICE TOKEN (`ksk-v1.<deviceId>.<agentId>.<sig>`, HMAC-SHA256 over the binding via the SAME
 * VOICE_CONFIG_HMAC_SECRET root). We verify it here and bind it to the agentId in the request —
 * a token for agent A cannot open a session for agent B.
 *
 * Fail-closed: a missing, secret-less, forged, or cross-agent token → unauthorized. No PHI is
 * read or logged. There is NO user login — the kiosk is anonymous by design (build guide §6/§7).
 */
import { verifyDeviceToken, KIOSK_TOKEN_HMAC_ENV } from '@/lib/kiosk/device-token';

/** Extract a Bearer token from the Authorization header (the device sets it). */
function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * Authorize a kiosk device for the requested agent. Returns true only when the token verifies
 * against the shared HMAC secret AND is bound to `agentId`.
 */
export function authorizeKioskDevice(req: Request, agentId: string): boolean {
  const token = bearer(req);
  if (!token) return false;
  return verifyDeviceToken(token, process.env[KIOSK_TOKEN_HMAC_ENV], agentId).valid;
}
