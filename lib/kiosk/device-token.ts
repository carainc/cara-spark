/**
 * Kiosk device-token mint/verify (T16 / CAR-2395).
 *
 * A kiosk box authenticates with a long-lived, revocable DEVICE TOKEN — not a user login
 * (anonymous by design; the houseless population this serves typically has no account). The
 * token is a detached HMAC over the device's binding fields (agentId + opaque deviceId), so
 * a forged or tampered token never authorizes a session. It is byte-stable and self-describing
 * so the OSS console can mint/print one and the Pi (or the `--sim` client) carries it verbatim.
 *
 * Reuses the SAME secret as the voice lane (VOICE_CONFIG_HMAC_SECRET) — the kiosk is just
 * another transport in front of the same engine, and shares the one tamper-evident root. No
 * new env var, no new crypto dependency: pure node:crypto HMAC-SHA256 + constant-time compare,
 * Node runtime only (never the Edge runtime). NEVER puts PHI in a token input.
 *
 * Token format (mirrors the proven `cara-voicecfg-v1.<nonce>.<sig>` scheme):
 *   ksk-v1.<deviceId-b64url>.<agentId-b64url>.<sig-b64url>
 * signed over `ksk-v1:<agentId>:<deviceId>`. The deviceId is an opaque, app-minted handle
 * (carries no PHI) so revocation is per-device and a token reveals only routing identifiers.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/** Env var that holds the shared HMAC secret — the SAME root the voice lane signs with. */
export const KIOSK_TOKEN_HMAC_ENV = 'VOICE_CONFIG_HMAC_SECRET';

/** Token scheme tag. Versioned so the format can rotate without ambiguity. */
export const KIOSK_TOKEN_PREFIX = 'ksk-v1';

/** Human-skimmable namespace for a device id — carries no PHI, minted from CSPRNG bytes only. */
export const KIOSK_DEVICE_PREFIX = 'dev_';

/** The fields a kiosk device token binds. PHI-free by construction — routing identifiers only. */
export interface KioskDeviceBinding {
  /** The published agent this device is scoped to (revocable per device). */
  agentId: string;
  /** Opaque, app-minted device handle. NEVER a serial/MAC tied to a person. */
  deviceId: string;
}

function requireSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      `${KIOSK_TOKEN_HMAC_ENV} is not set — refusing to mint/verify a kiosk device token (fail-closed).`,
    );
  }
  return secret;
}

/** Constant-time compare over the b64url signature strings; never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** The canonical, injection-safe signing string. Fixed order so sign + verify agree. */
function canonical(binding: KioskDeviceBinding): string {
  return `${KIOSK_TOKEN_PREFIX}:${binding.agentId}:${binding.deviceId}`;
}

/** Mint a fresh opaque device id. CSPRNG-only — never derived from any identifier. */
export function mintDeviceId(): string {
  return `${KIOSK_DEVICE_PREFIX}${randomBytes(12).toString('base64url')}`;
}

/**
 * Mint a device token for a (agentId, deviceId) binding. The console calls this to print the
 * `KIOSK_DEVICE_TOKEN` for a provisioned kiosk. Fail-closed: throws if the secret is unset.
 */
export function mintDeviceToken(binding: KioskDeviceBinding, secret: string | undefined): string {
  const s = requireSecret(secret);
  const sig = createHmac('sha256', s).update(canonical(binding), 'utf8').digest('base64url');
  const dev = Buffer.from(binding.deviceId, 'utf8').toString('base64url');
  const agent = Buffer.from(binding.agentId, 'utf8').toString('base64url');
  return `${KIOSK_TOKEN_PREFIX}.${dev}.${agent}.${sig}`;
}

/** A verified token's decoded binding (only ever returned after the HMAC checks out). */
export interface VerifiedDeviceToken {
  valid: boolean;
  agentId?: string;
  deviceId?: string;
}

/**
 * Verify a device token. Fail-closed: a malformed, unsigned, wrong-secret, or tampered token
 * returns { valid: false }. On success returns the bound agentId + deviceId (PHI-free) so the
 * route can pin the session to the device's agent.
 *
 * `expectedAgentId` (optional) additionally requires the token to be bound to that agent —
 * the route passes the agentId from the request body so a token for agent A cannot open a
 * session for agent B.
 */
export function verifyDeviceToken(
  token: string,
  secret: string | undefined,
  expectedAgentId?: string,
): VerifiedDeviceToken {
  if (!secret || !token) return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 4) return { valid: false };
  const [prefix, devB64, agentB64, sig] = parts;
  if (prefix !== KIOSK_TOKEN_PREFIX || !devB64 || !agentB64 || !sig) return { valid: false };

  let deviceId: string;
  let agentId: string;
  try {
    deviceId = Buffer.from(devB64, 'base64url').toString('utf8');
    agentId = Buffer.from(agentB64, 'base64url').toString('utf8');
  } catch {
    return { valid: false };
  }
  if (!deviceId || !agentId) return { valid: false };

  const expected = createHmac('sha256', secret)
    .update(canonical({ agentId, deviceId }), 'utf8')
    .digest('base64url');
  if (!safeEqual(sig, expected)) return { valid: false };

  // Bind to the requested agent when one is supplied (cross-agent replay protection).
  if (expectedAgentId !== undefined && expectedAgentId !== agentId) return { valid: false };

  return { valid: true, agentId, deviceId };
}
