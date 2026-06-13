/**
 * Shared MOCK transport for Cara tests. No live network ever — every test injects this.
 *
 * Records each request (url/method/headers/body) so tests can assert routing + headers, and replays
 * scripted responses by URL substring. A test-only API key uses a non-secret-shaped placeholder
 * ('x'.repeat(24)) per AGENTS.md — never a real ck_/sk_ literal.
 */

import type { CaraHttpResponse, CaraClientConfig, FetchLike } from '@/lib/cara/client';

export const TEST_API_KEY = 'x'.repeat(24);
export const TEST_TENANT_ID = 'tenant_test';
export const TEST_BASE_URL = 'https://proxy.test';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockRoute {
  /** Match if the request URL contains this substring. First match wins. */
  match: string;
  status?: number;
  json?: unknown;
  text?: string;
}

export interface MockFetch {
  fetchImpl: FetchLike;
  requests: RecordedRequest[];
}

export function makeMockFetch(routes: MockRoute[]): MockFetch {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body,
    });
    const route = routes.find((r) => url.includes(r.match));
    const status = route?.status ?? (route ? 200 : 404);
    const ok = status >= 200 && status < 300;
    const res: CaraHttpResponse = {
      status,
      ok,
      json: async () => route?.json ?? {},
      text: async () => route?.text ?? (route?.json ? JSON.stringify(route.json) : ''),
    };
    return res;
  };
  return { fetchImpl, requests };
}

export function testConfig(fetchImpl: FetchLike): CaraClientConfig {
  return { apiKey: TEST_API_KEY, tenantId: TEST_TENANT_ID, baseUrl: TEST_BASE_URL, fetchImpl };
}
