/**
 * Provider registry tests (T5) — Cara is the default; selection is config; the FROZEN seam is
 * honored (returned objects implement CommsProvider / EhrAdapter / IdentityVerifier). All MOCKED.
 */
import { describe, it, expect } from 'vitest';
import { getProviders, providerConfigFromEnv } from '@/lib/providers';
import { DEFAULT_PROVIDER_CONFIG } from '@/lib/providers/types';
import { makeMockFetch } from '@/lib/cara/__tests__/_mock-fetch';

const ENV: Record<string, string | undefined> = {
  CARA_API_KEY: 'x'.repeat(24),
  CARA_TENANT_ID: 'tenant_test',
  CARA_API_BASE_URL: 'https://proxy.test',
};

describe('providerConfigFromEnv', () => {
  it('defaults to the Cara seam (comms=cara, ehr=elation)', () => {
    expect(providerConfigFromEnv({})).toEqual(DEFAULT_PROVIDER_CONFIG);
  });

  it('honors explicit EHR vendor override', () => {
    const cfg = providerConfigFromEnv({ ...ENV, EHR_VENDOR: 'canvas' });
    expect(cfg.ehr).toBe('canvas');
  });
});

describe('getProviders', () => {
  it('wires Cara comms + EHR + identity (default config) against a mock transport', () => {
    const mock = makeMockFetch([]);
    // env must be present for CaraClient.fromEnv inside the factory.
    const restore = withEnv(ENV);
    try {
      const p = getProviders(DEFAULT_PROVIDER_CONFIG, { fetchImpl: mock.fetchImpl });
      expect(p.comms.vendor).toBe('cara');
      expect(p.ehr.vendor).toBe('elation');
      expect(typeof p.identity.requestOtp).toBe('function');
      expect(typeof p.identity.verifyOtp).toBe('function');
    } finally {
      restore();
    }
  });

  it('throws a clear "not wired" error for non-Cara comms vendors (config-add, not code)', () => {
    const restore = withEnv(ENV);
    try {
      expect(() => getProviders({ comms: 'twilio', ehr: 'elation' })).toThrow(/not wired/i);
    } finally {
      restore();
    }
  });
});

/** Temporarily set env vars, returning a restore fn. */
function withEnv(vars: Record<string, string | undefined>): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v !== undefined) process.env[k] = v;
  }
  return () => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  };
}
