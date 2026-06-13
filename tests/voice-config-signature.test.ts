/**
 * Voice config HMAC — sign → verify round-trip + tamper rejection, for BOTH surfaces:
 *   (1) the per-agent registration config signature, and
 *   (2) the worker→app bearer token.
 * Pure crypto, no network, no PHI. (Lane G mandatory test.)
 */
import { describe, it, expect } from 'vitest';
import {
  signConfig,
  verifyConfig,
  mintWorkerToken,
  verifyWorkerToken,
  type SignableVoiceConfig,
} from '@/lib/voice/config-signature';

const SECRET = 'test-hmac-secret-do-not-use-in-prod';

const cfg: SignableVoiceConfig = {
  agentId: 'agent-123',
  agentName: 'Front Desk',
  workerName: 'cara-spark-cascade',
  language: 'en',
  policyBundleVersion: 'default-0.1.0',
};

describe('voice config signature — registration', () => {
  it('round-trips: a signature signed with the secret verifies with the same secret', () => {
    const sig = signConfig(cfg, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/); // hex sha256
    expect(verifyConfig(cfg, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered config (workerName changed after signing)', () => {
    const sig = signConfig(cfg, SECRET);
    const tampered: SignableVoiceConfig = { ...cfg, workerName: 'cara-realtime' }; // prod name!
    expect(verifyConfig(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects a tampered policy version (downgrade attempt)', () => {
    const sig = signConfig(cfg, SECRET);
    const tampered: SignableVoiceConfig = { ...cfg, policyBundleVersion: 'attacker-0.0.0' };
    expect(verifyConfig(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const sig = signConfig(cfg, 'some-other-secret');
    expect(verifyConfig(cfg, sig, SECRET)).toBe(false);
  });

  it('fails closed when the secret is missing', () => {
    expect(() => signConfig(cfg, undefined)).toThrow(/VOICE_CONFIG_HMAC_SECRET/);
    expect(verifyConfig(cfg, 'deadbeef', undefined)).toBe(false);
  });

  it('rejects an empty / malformed signature', () => {
    expect(verifyConfig(cfg, '', SECRET)).toBe(false);
    expect(verifyConfig(cfg, 'not-hex', SECRET)).toBe(false);
  });
});

describe('voice worker token — bearer auth', () => {
  it('round-trips: a token minted for a session verifies for that session', () => {
    const token = mintWorkerToken('voicephone-agent-123-room', SECRET);
    expect(token.startsWith('cara-voicecfg-v1.')).toBe(true);
    expect(verifyWorkerToken(token, 'voicephone-agent-123-room', SECRET)).toBe(true);
  });

  it('rejects a token replayed against a DIFFERENT session id', () => {
    const token = mintWorkerToken('room-A', SECRET);
    expect(verifyWorkerToken(token, 'room-B', SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintWorkerToken('room-A', 'other-secret');
    expect(verifyWorkerToken(token, 'room-A', SECRET)).toBe(false);
  });

  it('rejects malformed tokens and fails closed without a secret', () => {
    expect(verifyWorkerToken('garbage', 'room-A', SECRET)).toBe(false);
    expect(verifyWorkerToken('a.b', 'room-A', SECRET)).toBe(false);
    expect(verifyWorkerToken(mintWorkerToken('room-A', SECRET), 'room-A', undefined)).toBe(false);
  });

  it('produces a fresh nonce each mint (tokens are not identical)', () => {
    const t1 = mintWorkerToken('room-A', SECRET);
    const t2 = mintWorkerToken('room-A', SECRET);
    expect(t1).not.toBe(t2);
    expect(verifyWorkerToken(t1, 'room-A', SECRET)).toBe(true);
    expect(verifyWorkerToken(t2, 'room-A', SECRET)).toBe(true);
  });
});
