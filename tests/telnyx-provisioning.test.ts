/**
 * Telnyx DID provisioning seam (tk-0024) — the SPEND GATE is the load-bearing contract here.
 *
 * Every test injects a MOCK fetch (no live network, no spend). The critical assertions:
 *   • searchAvailable parses a mocked Telnyx available-numbers response (read-only).
 *   • orderNumber WITHOUT confirmedSpend → `requires_approval` and makes ZERO order calls
 *     (asserted against the recorded requests — proves the app can never auto-buy).
 *   • orderNumber WITH confirmedSpend + the ALLOW_TELNYX_PROVISIONING flag → exactly ONE order call.
 *   • the flag alone, or confirmedSpend alone, does NOT open the gate.
 *   • the API key is never echoed in a thrown error.
 *   • assignNumberToAgent writes Channel.phoneNumber (DB-only, safe).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  TelnyxNumberProvisioner,
  assignNumberToAgent,
  provisioningAllowed,
  redactTelnyxError,
  TelnyxConfigError,
  TelnyxRequestError,
  telnyxConfigFromEnv,
  type FetchLike,
  type ProvisionHttpResponse,
  type ChannelPrisma,
} from '@/lib/telnyx/provisioning';

// Non-secret-shaped test key per AGENTS.md — never a real KEY... literal.
const TEST_KEY = 'x'.repeat(24);

interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
}

interface MockRoute {
  match: string;
  status?: number;
  json?: unknown;
  text?: string;
}

/** Records each request and replays scripted responses by URL substring. First match wins. */
function makeMockFetch(routes: MockRoute[]): { fetchImpl: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const route = routes.find((r) => url.includes(r.match));
    const status = route?.status ?? (route ? 200 : 404);
    const res: ProvisionHttpResponse = {
      status,
      ok: status >= 200 && status < 300,
      json: async () => route?.json ?? {},
      text: async () => route?.text ?? (route?.json ? JSON.stringify(route.json) : ''),
    };
    return res;
  };
  return { fetchImpl, requests };
}

const SEARCH_RESPONSE = {
  data: [
    {
      phone_number: '+14155550123',
      region_information: [
        { region_type: 'country_code', region_name: 'US' },
        { region_type: 'locality', region_name: 'San Francisco' },
      ],
      cost_information: { monthly_cost: '1.00', currency: 'USD' },
    },
    {
      phone_number: '+14155550199',
      region_information: [{ region_type: 'locality', region_name: 'San Francisco' }],
      cost_information: { monthly_cost: '1.00', currency: 'USD' },
    },
    // A malformed hit with no phone_number must be filtered out (defensive parsing).
    { region_information: [] },
  ],
};

describe('searchAvailable — read-only number search', () => {
  it('parses a mocked Telnyx available-numbers response into vendor-agnostic numbers', async () => {
    const mock = makeMockFetch([{ match: '/available_phone_numbers', json: SEARCH_RESPONSE }]);
    const prov = new TelnyxNumberProvisioner({ apiKey: TEST_KEY, fetchImpl: mock.fetchImpl });

    const numbers = await prov.searchAvailable({ areaCode: '415', limit: 5 });

    expect(numbers).toEqual([
      { phoneNumber: '+14155550123', region: 'San Francisco', monthlyCost: '1.00', currency: 'USD' },
      { phoneNumber: '+14155550199', region: 'San Francisco', monthlyCost: '1.00', currency: 'USD' },
    ]);
    // Read-only GET; the area-code filter rides the query string.
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe('GET');
    expect(mock.requests[0].url).toContain('national_destination_code');
    expect(mock.requests[0].url).toContain('415');
  });

  it('throws a redaction-safe TelnyxRequestError on a non-OK search (no key leak)', async () => {
    const mock = makeMockFetch([
      { match: '/available_phone_numbers', status: 401, text: `bad key ${TEST_KEY}` },
    ]);
    const prov = new TelnyxNumberProvisioner({ apiKey: TEST_KEY, fetchImpl: mock.fetchImpl });
    await expect(prov.searchAvailable({ areaCode: '415' })).rejects.toThrowError(TelnyxRequestError);
    await expect(prov.searchAvailable({ areaCode: '415' })).rejects.not.toThrowError(
      new RegExp(TEST_KEY),
    );
  });
});

describe('orderNumber — the SPEND GATE (default OFF)', () => {
  it('WITHOUT confirmedSpend → requires_approval and makes ZERO order calls', async () => {
    // Even with the env flag ON, no confirmedSpend means the gate stays closed.
    const mock = makeMockFetch([
      { match: '/available_phone_numbers', json: SEARCH_RESPONSE }, // for the cost estimate
      { match: '/number_orders', json: { data: { id: 'should-never-be-called' } } },
    ]);
    const prov = new TelnyxNumberProvisioner({
      apiKey: TEST_KEY,
      fetchImpl: mock.fetchImpl,
      env: { ALLOW_TELNYX_PROVISIONING: 'true' },
    });

    const res = await prov.orderNumber({ phoneNumber: '+14155550123' });

    expect(res.status).toBe('requires_approval');
    if (res.status === 'requires_approval') {
      expect(res.reason).toBe('gate_closed');
      expect(res.candidate).toEqual({ phoneNumber: '+14155550123' });
    }
    // THE critical assertion: the order endpoint was NEVER hit.
    expect(mock.requests.some((r) => r.url.includes('/number_orders'))).toBe(false);
  });

  it('confirmedSpend WITHOUT the env flag → requires_approval, ZERO order calls', async () => {
    const orderFetch = vi.fn<FetchLike>(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ data: { id: 'nope' } }),
      text: async () => '',
    }));
    const prov = new TelnyxNumberProvisioner({
      apiKey: TEST_KEY,
      fetchImpl: orderFetch,
      env: {}, // flag absent
    });

    const res = await prov.orderNumber({ phoneNumber: '+14155550123' }, { confirmedSpend: true });

    expect(res.status).toBe('requires_approval');
    // The estimate GET may run, but NO POST to /number_orders.
    const postCalls = orderFetch.mock.calls.filter(
      ([url, init]) => init?.method === 'POST' && url.includes('/number_orders'),
    );
    expect(postCalls).toHaveLength(0);
  });

  it('WITH confirmedSpend + the env flag → places exactly ONE order call', async () => {
    const mock = makeMockFetch([{ match: '/number_orders', json: { data: { id: 'ord_123' } } }]);
    const prov = new TelnyxNumberProvisioner({
      apiKey: TEST_KEY,
      fetchImpl: mock.fetchImpl,
      env: { ALLOW_TELNYX_PROVISIONING: 'true' },
    });

    const res = await prov.orderNumber({ phoneNumber: '+14155550123' }, { confirmedSpend: true });

    expect(res.status).toBe('ordered');
    if (res.status === 'ordered') {
      expect(res.phoneNumber).toBe('+14155550123');
      expect(res.orderId).toBe('ord_123');
    }
    const orderCalls = mock.requests.filter((r) => r.url.includes('/number_orders'));
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0].method).toBe('POST');
    expect(orderCalls[0].body).toContain('+14155550123');
  });

  it('a truthy-but-not-true confirmedSpend does NOT open the gate', async () => {
    const mock = makeMockFetch([{ match: '/number_orders', json: { data: { id: 'nope' } } }]);
    const prov = new TelnyxNumberProvisioner({
      apiKey: TEST_KEY,
      fetchImpl: mock.fetchImpl,
      env: { ALLOW_TELNYX_PROVISIONING: 'true' },
    });
    // @ts-expect-error — intentionally passing a non-boolean to prove `=== true` is enforced.
    const res = await prov.orderNumber({ phoneNumber: '+14155550123' }, { confirmedSpend: 'true' });
    expect(res.status).toBe('requires_approval');
    expect(mock.requests.some((r) => r.url.includes('/number_orders'))).toBe(false);
  });
});

describe('provisioningAllowed — the deploy-level flag', () => {
  it('is OFF by default and for non-truthy values', () => {
    expect(provisioningAllowed({})).toBe(false);
    expect(provisioningAllowed({ ALLOW_TELNYX_PROVISIONING: '' })).toBe(false);
    expect(provisioningAllowed({ ALLOW_TELNYX_PROVISIONING: 'false' })).toBe(false);
    expect(provisioningAllowed({ ALLOW_TELNYX_PROVISIONING: '0' })).toBe(false);
  });
  it('is ON only for explicit truthy values', () => {
    expect(provisioningAllowed({ ALLOW_TELNYX_PROVISIONING: '1' })).toBe(true);
    expect(provisioningAllowed({ ALLOW_TELNYX_PROVISIONING: 'true' })).toBe(true);
    expect(provisioningAllowed({ ALLOW_TELNYX_PROVISIONING: 'YES' })).toBe(true);
    expect(provisioningAllowed({ ALLOW_TELNYX_PROVISIONING: 'on' })).toBe(true);
  });
});

describe('config + redaction safety', () => {
  it('telnyxConfigFromEnv names the missing var, never echoes a value', () => {
    expect(() => telnyxConfigFromEnv({})).toThrowError(TelnyxConfigError);
    expect(() => telnyxConfigFromEnv({})).toThrowError(/TELNYX_API_KEY/);
  });
  it('redactTelnyxError strips the exact key and key/bearer shapes', () => {
    const secret = 'x'.repeat(24);
    expect(redactTelnyxError(`leaked ${secret} here`, secret)).not.toContain(secret);
    expect(redactTelnyxError('KEY0123456789abcdef')).toContain('[REDACTED]');
    expect(redactTelnyxError('Authorization: Bearer abcdef0123456789')).toContain('Bearer [REDACTED]');
  });
  it('never exposes the apiKey on the instance surface', () => {
    const prov = new TelnyxNumberProvisioner({ apiKey: TEST_KEY });
    expect(JSON.stringify(prov)).not.toContain(TEST_KEY);
    expect(Object.values(prov as unknown as Record<string, unknown>)).not.toContain(TEST_KEY);
  });
});

describe('assignNumberToAgent — DB-only DID assignment (safe)', () => {
  it('upserts the PHONE channel and writes phoneNumber', async () => {
    // Typed to the full ChannelPrisma upsert arg so mock.calls carries where/update/create.
    type UpsertArg = Parameters<ChannelPrisma['channel']['upsert']>[0];
    const upsert = vi.fn(async (args: UpsertArg) => ({
      id: 'chan-1',
      agentId: 'agent-1',
      kind: 'PHONE' as const,
      phoneNumber: (args.create as { phoneNumber: string }).phoneNumber,
    }));
    const prisma: ChannelPrisma = { channel: { upsert } };

    const res = await assignNumberToAgent(prisma, 'agent-1', '  +14155550123  ');

    expect(res).toEqual({ agentId: 'agent-1', phoneNumber: '+14155550123' });
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where.agentId_kind).toEqual({ agentId: 'agent-1', kind: 'PHONE' });
    expect((arg.update as { phoneNumber: string }).phoneNumber).toBe('+14155550123'); // trimmed
  });

  it('rejects an empty DID (never writes a blank number)', async () => {
    const upsert = vi.fn();
    const prisma = { channel: { upsert } } as unknown as ChannelPrisma;
    await expect(assignNumberToAgent(prisma, 'agent-1', '   ')).rejects.toThrow(/DID is required/);
    expect(upsert).not.toHaveBeenCalled();
  });
});
