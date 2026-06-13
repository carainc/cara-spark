import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authorizeWorker } from '@/app/api/voice/_auth';
import { mintWorkerToken } from '@/lib/voice/config-signature';

// Arbitrary fixture string (not a credential) — only feeds the HMAC in this unit test.
const HMAC = 'test-hmac-fixture';
const SESSION = 'call_abc';

function req(token?: string): Request {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example/api/voice/decide', { method: 'POST', headers });
}

describe('authorizeWorker — worker→app bearer auth (fail-closed)', () => {
  beforeEach(() => {
    process.env.VOICE_CONFIG_HMAC_SECRET = HMAC;
  });
  afterEach(() => {
    delete process.env.VOICE_CONFIG_HMAC_SECRET;
  });

  it('accepts a token minted for the same session', () => {
    expect(authorizeWorker(req(mintWorkerToken(SESSION, HMAC)), SESSION)).toBe(true);
  });

  it('rejects a missing Authorization header', () => {
    expect(authorizeWorker(req(), SESSION)).toBe(false);
  });

  it('rejects a token minted for a DIFFERENT session', () => {
    expect(authorizeWorker(req(mintWorkerToken('other_session', HMAC)), SESSION)).toBe(false);
  });

  it('rejects a forged / malformed token', () => {
    expect(authorizeWorker(req('cara-voicecfg-v1.deadbeef.forged'), SESSION)).toBe(false);
    expect(authorizeWorker(req('not-even-a-token'), SESSION)).toBe(false);
  });

  it('fails closed when the shared secret is unset', () => {
    const token = mintWorkerToken(SESSION, HMAC);
    delete process.env.VOICE_CONFIG_HMAC_SECRET;
    expect(authorizeWorker(req(token), SESSION)).toBe(false);
  });
});
