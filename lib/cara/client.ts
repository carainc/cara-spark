/**
 * Cara proxy HTTP client (T5, tk-0005) — the default impl behind the provider seam.
 *
 * One key + one base URL fronts vendor-agnostic comms (SMS/email/OTP) and a vendor-agnostic
 * EHR proxy (elation | canvas | healthie). Swapping vendors is a CONFIG change (which path /
 * which header), never a code change — see lib/providers/types.ts (FROZEN).
 *
 * SAFETY (load-bearing):
 *  - The API key is read from env ONLY (CARA_API_KEY) and is NEVER logged, never thrown in an
 *    error message, never serialised. `redactError` strips it defensively.
 *  - Raw destinations (phone/email) and any PHI are NEVER logged.
 *  - `fetch` is injectable so every test runs fully MOCKED (no live network).
 */

import type { EhrVendor } from '@/lib/providers/types';

/** Minimal fetch shape we depend on — lets tests inject a mock without DOM lib coupling. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<CaraHttpResponse>;

export interface CaraHttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface CaraClientConfig {
  apiKey: string;
  tenantId: string;
  baseUrl: string;
  /** Injectable for tests; defaults to global fetch in production. */
  fetchImpl?: FetchLike;
}

export class CaraConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaraConfigError';
  }
}

/** A transport error that is SAFE to log/propagate — never carries the key or request body. */
export class CaraRequestError extends Error {
  readonly status: number;
  readonly rateLimited: boolean;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CaraRequestError';
    this.status = status;
    this.rateLimited = status === 429;
  }
}

const DEFAULT_BASE_URL = 'https://api.caramedical.com';

/**
 * Resolve config from the environment. The key/tenant are required for LIVE calls; absent →
 * CaraConfigError (the caller decides whether to surface a "needs CARA_API_KEY" gate). The value
 * is never echoed back in the error.
 */
export function caraConfigFromEnv(env: Record<string, string | undefined> = process.env): CaraClientConfig {
  const apiKey = env.CARA_API_KEY?.trim();
  const tenantId = env.CARA_TENANT_ID?.trim();
  const baseUrl = env.CARA_API_BASE_URL?.trim() || DEFAULT_BASE_URL;

  if (!apiKey) {
    // NOTE: we name the missing var, never its value.
    throw new CaraConfigError('CARA_API_KEY is not set (env only — never commit it).');
  }
  if (!tenantId) {
    throw new CaraConfigError('CARA_TENANT_ID is not set.');
  }
  return { apiKey, tenantId, baseUrl };
}

/** Strip anything secret-shaped from a value before it can reach a log/throw site. */
export function redactError(value: unknown, secret?: string): string {
  let msg = value instanceof Error ? value.message : String(value);
  if (secret && secret.length > 0) {
    msg = msg.split(secret).join('[REDACTED]');
  }
  // Defensive: redact ck_/sk_/bearer-shaped tokens even if the exact secret wasn't passed.
  msg = msg.replace(/\b(?:ck|sk)_[A-Za-z0-9]{8,}\b/g, '[REDACTED]');
  msg = msg.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, 'Bearer [REDACTED]');
  return msg;
}

/**
 * Thin authenticated client over the Cara proxy. Holds the key in a closure (never on a public
 * field), injects auth headers, and returns parsed JSON or throws a redaction-safe error.
 */
export class CaraClient {
  private readonly tenantId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  // Private + non-enumerable-by-convention: never expose the key on the instance surface.
  readonly #apiKey: string;

  constructor(config: CaraClientConfig) {
    if (!config.apiKey) throw new CaraConfigError('CaraClient requires an apiKey.');
    if (!config.tenantId) throw new CaraConfigError('CaraClient requires a tenantId.');
    this.#apiKey = config.apiKey;
    this.tenantId = config.tenantId;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? defaultFetch;
  }

  static fromEnv(env?: Record<string, string | undefined>, fetchImpl?: FetchLike): CaraClient {
    const cfg = caraConfigFromEnv(env);
    return new CaraClient({ ...cfg, fetchImpl });
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.#apiKey}`,
      'X-Tenant-ID': this.tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /** GET a proxy path. `path` is server-controlled (e.g. an opaque externalId), not free PHI. */
  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** POST a JSON body. The body may carry server-side PHI; it is NEVER logged. */
  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    let res: CaraHttpResponse;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // Network/transport failure — scrub before re-throwing (never leak key/body).
      throw new CaraRequestError(0, redactError(err, this.#apiKey));
    }

    if (!res.ok) {
      // Read a short error text but redact it; do NOT echo the request body.
      let detail = `${method} ${path} failed with ${res.status}`;
      try {
        const text = await res.text();
        if (text) detail = `${detail}: ${redactError(text, this.#apiKey)}`;
      } catch {
        /* ignore body-read failure */
      }
      throw new CaraRequestError(res.status, detail);
    }

    return (await res.json()) as T;
  }
}

/** The production fetch — wraps global fetch into our FetchLike shape. */
const defaultFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init as RequestInit);
  return {
    status: res.status,
    ok: res.ok,
    json: () => res.json(),
    text: () => res.text(),
  };
};

/** Map an EHR vendor + sub-resource to its proxy path. Vendor-agnostic: only the path changes. */
export function ehrPath(vendor: EhrVendor, resource: string): string {
  const clean = resource.startsWith('/') ? resource.slice(1) : resource;
  return `/ehr/${vendor}/${clean}`;
}
