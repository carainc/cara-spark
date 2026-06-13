/**
 * CaraClient tests (T5) — env-only key, redaction, and no-console-leak.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CaraClient,
  CaraConfigError,
  CaraRequestError,
  caraConfigFromEnv,
  redactError,
  ehrPath,
} from '@/lib/cara/client';
import { makeMockFetch, TEST_API_KEY } from './_mock-fetch';

afterEach(() => vi.restoreAllMocks());

describe('caraConfigFromEnv — key read from env only', () => {
  it('reads CARA_API_KEY / CARA_TENANT_ID / base url from the passed env', () => {
    const cfg = caraConfigFromEnv({
      CARA_API_KEY: TEST_API_KEY,
      CARA_TENANT_ID: 'tenant_x',
      CARA_API_BASE_URL: 'https://proxy.test',
    });
    expect(cfg).toMatchObject({ apiKey: TEST_API_KEY, tenantId: 'tenant_x', baseUrl: 'https://proxy.test' });
  });

  it('throws CaraConfigError naming the missing var — and never echoes a value', () => {
    expect(() => caraConfigFromEnv({ CARA_TENANT_ID: 'tenant_x' })).toThrow(CaraConfigError);
    try {
      caraConfigFromEnv({ CARA_TENANT_ID: 'tenant_x' });
    } catch (e) {
      expect((e as Error).message).toContain('CARA_API_KEY');
      expect((e as Error).message).not.toContain(TEST_API_KEY);
    }
  });

  it('defaults the base url when unset', () => {
    const cfg = caraConfigFromEnv({ CARA_API_KEY: TEST_API_KEY, CARA_TENANT_ID: 't' });
    expect(cfg.baseUrl).toBe('https://api.caramedical.com');
  });
});

describe('redactError', () => {
  it('strips the exact secret and secret-shaped tokens', () => {
    // Build the shapes at runtime so NO secret-shaped literal lives in the test source.
    const bearerShaped = `Authorization: Bearer ${'a'.repeat(20)}`;
    const ckShaped = `token ck_${'a'.repeat(20)}`;
    expect(redactError(new Error(`fail ${TEST_API_KEY}`), TEST_API_KEY)).not.toContain(TEST_API_KEY);
    expect(redactError(bearerShaped)).toContain('[REDACTED]');
    expect(redactError(ckShaped)).toContain('[REDACTED]');
  });
});

describe('CaraClient request behaviour', () => {
  it('does not expose the API key on the instance surface', () => {
    const mock = makeMockFetch([]);
    const client = new CaraClient({ apiKey: TEST_API_KEY, tenantId: 't', baseUrl: 'https://x', fetchImpl: mock.fetchImpl });
    // No enumerable property carries the key.
    expect(JSON.stringify(client)).not.toContain(TEST_API_KEY);
    expect(Object.values(client as unknown as Record<string, unknown>)).not.toContain(TEST_API_KEY);
  });

  it('throws a CaraRequestError (rateLimited flag set on 429) with no key in the message', async () => {
    const mock = makeMockFetch([{ match: '/x', status: 429, text: `nope ${TEST_API_KEY}` }]);
    const client = new CaraClient({ apiKey: TEST_API_KEY, tenantId: 't', baseUrl: 'https://x', fetchImpl: mock.fetchImpl });
    const err = await client.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaraRequestError);
    expect((err as CaraRequestError).rateLimited).toBe(true);
    expect((err as CaraRequestError).message).not.toContain(TEST_API_KEY);
  });

  it('never writes the API key to console during a request lifecycle', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
    const mock = makeMockFetch([{ match: '/ok', json: { ok: true } }, { match: '/bad', status: 500, text: 'err' }]);
    const client = new CaraClient({ apiKey: TEST_API_KEY, tenantId: 't', baseUrl: 'https://x', fetchImpl: mock.fetchImpl });

    await client.get('/ok');
    await client.get('/bad').catch(() => {});

    const everythingLogged = spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n');
    expect(everythingLogged).not.toContain(TEST_API_KEY);
  });
});

describe('ehrPath', () => {
  it('builds /ehr/{vendor}/{resource}', () => {
    expect(ehrPath('elation', 'patients/search')).toBe('/ehr/elation/patients/search');
    expect(ehrPath('canvas', '/patients/1')).toBe('/ehr/canvas/patients/1');
  });
});
