/**
 * HMAC config signing for the standalone voice stack (T13).
 *
 * Two tamper-evident surfaces share one secret (VOICE_CONFIG_HMAC_SECRET):
 *
 *  1. The per-agent voice *registration* config — `signConfig`/`verifyConfig` produce a
 *     detached HMAC over the canonical registration fields so the worker can prove the
 *     dispatch instruction (which agent + policy version) was authored by the app and not
 *     forged. `VoiceAgentRegistration.configSignature` carries it.
 *
 *  2. The worker→app *bearer token* the agent-worker mints to authenticate its mid-call
 *     policy-decision / post-call calls — `mintWorkerToken`/`verifyWorkerToken`. This is
 *     byte-compatible with the proven cara-prod worker scheme (`cara-voicecfg-v1.<nonce>.<sig>`)
 *     so the same Python worker token works against this app verifier unchanged.
 *
 * Pure Node crypto (HMAC-SHA256, constant-time compare) — no new dependency, runs in the
 * Node runtime (NOT the Edge runtime). NEVER puts PHI in a signature input.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/** Env var that holds the shared HMAC secret. Documented in .env.example. */
export const VOICE_CONFIG_HMAC_ENV = 'VOICE_CONFIG_HMAC_SECRET';

/** Bearer-token scheme tag — kept byte-identical to the proven cara-prod worker. */
export const WORKER_TOKEN_PREFIX = 'cara-voicecfg-v1';

/**
 * The subset of a registration that is signed. PHI-free by construction — only routing +
 * policy-version identifiers, never a name/DOB/phone. Order is fixed so the canonical string
 * is stable across sign + verify.
 */
export interface SignableVoiceConfig {
  agentId: string;
  agentName: string;
  workerName: string;
  language: 'en' | 'es';
  policyBundleVersion: string;
}

/** Deterministic, injection-safe canonical string for the signable config. */
function canonicalConfig(cfg: SignableVoiceConfig): string {
  // Newline-join fixed fields; values are app-controlled identifiers (no free text / PHI).
  return [
    `v=1`,
    `agentId=${cfg.agentId}`,
    `agentName=${cfg.agentName}`,
    `workerName=${cfg.workerName}`,
    `language=${cfg.language}`,
    `policyBundleVersion=${cfg.policyBundleVersion}`,
  ].join('\n');
}

function hmacHex(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function requireSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      `${VOICE_CONFIG_HMAC_ENV} is not set — refusing to sign/verify voice config (fail-closed).`,
    );
  }
  return secret;
}

/** Sign a registration config → hex HMAC for `VoiceAgentRegistration.configSignature`. */
export function signConfig(cfg: SignableVoiceConfig, secret: string | undefined): string {
  return hmacHex(canonicalConfig(cfg), requireSecret(secret));
}

/** Verify a detached config signature. Fail-closed: any mismatch / missing secret → false. */
export function verifyConfig(
  cfg: SignableVoiceConfig,
  signature: string,
  secret: string | undefined,
): boolean {
  if (!secret || !signature) return false;
  return safeEqualHex(signature, hmacHex(canonicalConfig(cfg), secret));
}

/**
 * Mint a worker→app bearer token for a given session/room id. Format:
 *   cara-voicecfg-v1.<nonce-b64url>.<sig-b64url>
 * signed over `cara-voicecfg-v1:<sessionId>:<nonce>`. Mirrors the proven worker exactly.
 */
export function mintWorkerToken(sessionId: string, secret: string | undefined): string {
  const s = requireSecret(secret);
  const nonce = randomBytes(16).toString('base64url');
  const sig = createHmac('sha256', s)
    .update(`${WORKER_TOKEN_PREFIX}:${sessionId}:${nonce}`, 'utf8')
    .digest('base64url');
  return `${WORKER_TOKEN_PREFIX}.${nonce}.${sig}`;
}

/** Verify a worker bearer token for a session/room id. Fail-closed on any malformed input. */
export function verifyWorkerToken(
  token: string,
  sessionId: string,
  secret: string | undefined,
): boolean {
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [prefix, nonce, sig] = parts;
  if (prefix !== WORKER_TOKEN_PREFIX || !nonce || !sig) return false;
  const expected = createHmac('sha256', secret)
    .update(`${WORKER_TOKEN_PREFIX}:${sessionId}:${nonce}`, 'utf8')
    .digest('base64url');
  return safeEqualHex(sig, expected);
}
