/**
 * Number provisioning seam (tk-0024) — a vendor-agnostic DID provisioning interface plus a
 * Telnyx implementation, behind a HARD spend gate.
 *
 * Buying a phone number (a DID) costs real money and is, by org policy, a HUMAN-gated action
 * (see the runbook). This module exists so the app can SEARCH available numbers (free, read-only)
 * and REQUEST provisioning — but it MUST NOT place a real order on any path that runs by default.
 *
 * SAFETY (load-bearing — do not weaken):
 *  - `searchAvailable` is read-only (a GET against the Telnyx number search endpoint). Safe.
 *  - `orderNumber` is GATED. It places a real order ONLY when BOTH hold:
 *        1. `opts.confirmedSpend === true`  (an explicit per-call confirmation token), AND
 *        2. the `ALLOW_TELNYX_PROVISIONING` env flag is truthy  (a deploy-level kill switch).
 *    Default is OFF. With the gate closed it returns `{ status: 'requires_approval', ... }` and
 *    makes ZERO calls to the order endpoint. Tests assert the order fetch is never invoked.
 *  - The API key is read from env ONLY (`TELNYX_API_KEY`) and is NEVER logged, never thrown in an
 *    error message, never serialised. `redactTelnyxError` strips it (and bearer/key shapes)
 *    defensively before anything reaches a log or throw site.
 *  - No PHI here — DIDs/area codes/regions are not patient data. `assignNumberToAgent` writes only
 *    the DID string onto a Channel row.
 *  - `fetch` is injectable so every test runs fully MOCKED (no live network, no spend).
 *
 * This NEVER touches the prod Telnyx trunk/connection (runbook §3, PROD-LiveKit/Telnyx isolation).
 * A standalone build provisions ALL-NEW `project=cara-spark`-tagged numbers; wiring a connection is
 * a separate, human-gated step that is intentionally NOT performed here.
 */

import type { ChannelKind } from '@prisma/client';

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

/** Deploy-level kill switch. Provisioning is OFF unless this env flag is explicitly truthy. */
export const ALLOW_TELNYX_PROVISIONING_ENV = 'ALLOW_TELNYX_PROVISIONING';

/** Minimal fetch shape we depend on — lets tests inject a mock without DOM lib coupling. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<ProvisionHttpResponse>;

export interface ProvisionHttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** A number that is available to order, normalised across vendors. No PHI. */
export interface AvailableNumber {
  /** E.164 DID, e.g. "+14155550123". */
  phoneNumber: string;
  /** Best-effort region label (locality / administrative area) when the vendor supplies it. */
  region?: string;
  /** Monthly cost in the smallest sane unit the vendor reports (string to avoid float drift). */
  monthlyCost?: string;
  /** Currency code, e.g. "USD". */
  currency?: string;
}

/** What to search for. Either an area code (NANP) or a free-text region/locality. */
export interface SearchSpec {
  areaCode?: string;
  region?: string;
  /** Max results to return (the vendor may cap this). */
  limit?: number;
}

/** The desired number to order. */
export interface OrderSpec {
  phoneNumber: string;
}

/** Per-call ordering controls. Default (empty) = the gate is CLOSED → no order is placed. */
export interface OrderOpts {
  /**
   * Explicit, per-call spend confirmation. MUST be exactly `true` (alongside the env flag) for a
   * real order to be placed. A truthy-but-not-true value does NOT open the gate.
   */
  confirmedSpend?: boolean;
}

/** Result of an `orderNumber` call. */
export type OrderResult =
  | {
      /** The gate was closed (default). No order endpoint was called. */
      status: 'requires_approval';
      reason: 'gate_closed';
      /** Best-effort estimated monthly cost (from a prior search), surfaced for the approval UI. */
      estimatedCost?: { monthlyCost?: string; currency?: string };
      candidate: OrderSpec;
    }
  | {
      /** A real order was placed (gate fully open) and the vendor accepted it. */
      status: 'ordered';
      phoneNumber: string;
      /** Opaque vendor order id, for audit. */
      orderId?: string;
    };

/**
 * Vendor-agnostic DID provisioning. `searchAvailable` is read-only; `orderNumber` is spend-gated.
 * Swapping Telnyx for another carrier is a new impl of THIS interface — callers never change.
 */
export interface NumberProvisioner {
  readonly vendor: string;
  /** Read-only: list numbers available to order. Never spends. */
  searchAvailable(spec: SearchSpec): Promise<AvailableNumber[]>;
  /**
   * Spend-gated: place an order ONLY when `opts.confirmedSpend === true` AND the
   * ALLOW_TELNYX_PROVISIONING env flag is set. Otherwise returns `requires_approval` and makes
   * ZERO order calls.
   */
  orderNumber(spec: OrderSpec, opts?: OrderOpts): Promise<OrderResult>;
}

export class TelnyxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelnyxConfigError';
  }
}

/** A transport error that is SAFE to log/propagate — never carries the key or request body. */
export class TelnyxRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'TelnyxRequestError';
    this.status = status;
  }
}

/** Strip anything secret-shaped from a value before it can reach a log/throw site. */
export function redactTelnyxError(value: unknown, secret?: string): string {
  let msg = value instanceof Error ? value.message : String(value);
  if (secret && secret.length > 0) {
    msg = msg.split(secret).join('[REDACTED]');
  }
  // Defensive: Telnyx keys are commonly `KEY...`; also scrub bearer-shaped tokens.
  msg = msg.replace(/\bKEY[A-Za-z0-9._-]{8,}\b/g, '[REDACTED]');
  msg = msg.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, 'Bearer [REDACTED]');
  return msg;
}

/** Is the deploy-level provisioning flag explicitly on? Anything but a clear truthy = OFF. */
export function provisioningAllowed(env: Record<string, string | undefined> = process.env): boolean {
  const v = env[ALLOW_TELNYX_PROVISIONING_ENV]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export interface TelnyxProvisionerConfig {
  apiKey: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch in production. */
  fetchImpl?: FetchLike;
  /** Override the env source (tests). Defaults to process.env — read for the spend flag only. */
  env?: Record<string, string | undefined>;
}

/**
 * Resolve config from the environment. The key is required for LIVE calls; absent →
 * TelnyxConfigError (the caller surfaces a "needs TELNYX_API_KEY" gate). The value is never echoed.
 */
export function telnyxConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: FetchLike,
): TelnyxProvisionerConfig {
  const apiKey = env.TELNYX_API_KEY?.trim();
  if (!apiKey) {
    // NOTE: we name the missing var, never its value.
    throw new TelnyxConfigError('TELNYX_API_KEY is not set (env only — never commit it).');
  }
  return { apiKey, fetchImpl, env };
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

/** Shape of a Telnyx available-numbers search hit (the fields we read; vendor sends more). */
interface TelnyxAvailableNumber {
  phone_number?: string;
  region_information?: Array<{ region_type?: string; region_name?: string }>;
  cost_information?: { monthly_cost?: string; currency?: string };
}

/**
 * The Telnyx implementation of the provisioning seam. Holds the key in a private field (never on a
 * public surface), injects auth headers, and — critically — gates `orderNumber` behind an explicit
 * per-call confirmation AND the deploy flag so it can NEVER auto-spend.
 */
export class TelnyxNumberProvisioner implements NumberProvisioner {
  readonly vendor = 'telnyx';
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly env: Record<string, string | undefined>;
  // Private: never expose the key on the instance surface.
  readonly #apiKey: string;

  constructor(config: TelnyxProvisionerConfig) {
    if (!config.apiKey) throw new TelnyxConfigError('TelnyxNumberProvisioner requires an apiKey.');
    this.#apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? TELNYX_API_BASE).replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? defaultFetch;
    this.env = config.env ?? process.env;
  }

  static fromEnv(env?: Record<string, string | undefined>, fetchImpl?: FetchLike): TelnyxNumberProvisioner {
    const cfg = telnyxConfigFromEnv(env, fetchImpl);
    return new TelnyxNumberProvisioner(cfg);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.#apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Read-only number search. GETs the Telnyx available-numbers endpoint with a filter and parses
   * the result into vendor-agnostic `AvailableNumber`s. No spend, no order.
   */
  async searchAvailable(spec: SearchSpec): Promise<AvailableNumber[]> {
    const params = new URLSearchParams();
    if (spec.areaCode) params.set('filter[national_destination_code]', spec.areaCode);
    if (spec.region) params.set('filter[locality]', spec.region);
    params.set('filter[limit]', String(spec.limit ?? 10));
    const url = `${this.baseUrl}/available_phone_numbers?${params.toString()}`;

    const payload = await this.request<{ data?: TelnyxAvailableNumber[] }>('GET', url);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data
      .filter((n): n is TelnyxAvailableNumber & { phone_number: string } => typeof n.phone_number === 'string')
      .map((n) => {
        const locality = n.region_information?.find((r) => r.region_type === 'locality')?.region_name;
        const region = locality ?? n.region_information?.[0]?.region_name;
        return {
          phoneNumber: n.phone_number,
          region,
          monthlyCost: n.cost_information?.monthly_cost,
          currency: n.cost_information?.currency,
        };
      });
  }

  /**
   * SPEND-GATED order. Returns `requires_approval` WITHOUT calling the order endpoint unless BOTH
   * the per-call `confirmedSpend === true` AND the ALLOW_TELNYX_PROVISIONING env flag are set.
   *
   * The gate is checked BEFORE any order fetch is constructed, so a closed gate provably makes zero
   * order calls (the tests assert this against a mock).
   */
  async orderNumber(spec: OrderSpec, opts: OrderOpts = {}): Promise<OrderResult> {
    const gateOpen = opts.confirmedSpend === true && provisioningAllowed(this.env);
    if (!gateOpen) {
      // Default path: NO order endpoint is called. Surface the candidate + a best-effort estimate.
      const estimate = await this.estimateCost(spec.phoneNumber).catch(() => undefined);
      return {
        status: 'requires_approval',
        reason: 'gate_closed',
        estimatedCost: estimate,
        candidate: spec,
      };
    }

    // Gate fully open (explicit confirmation + deploy flag): place the real order.
    const url = `${this.baseUrl}/number_orders`;
    const payload = await this.request<{ data?: { id?: string } }>('POST', url, {
      phone_numbers: [{ phone_number: spec.phoneNumber }],
    });
    return { status: 'ordered', phoneNumber: spec.phoneNumber, orderId: payload?.data?.id };
  }

  /** Best-effort monthly-cost lookup for a specific number (read-only). Never spends. */
  private async estimateCost(
    phoneNumber: string,
  ): Promise<{ monthlyCost?: string; currency?: string } | undefined> {
    const params = new URLSearchParams({ 'filter[phone_number]': phoneNumber, 'filter[limit]': '1' });
    const url = `${this.baseUrl}/available_phone_numbers?${params.toString()}`;
    const payload = await this.request<{ data?: TelnyxAvailableNumber[] }>('GET', url);
    const hit = payload?.data?.[0];
    if (!hit?.cost_information) return undefined;
    return { monthlyCost: hit.cost_information.monthly_cost, currency: hit.cost_information.currency };
  }

  private async request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
    let res: ProvisionHttpResponse;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // Network/transport failure — scrub before re-throwing (never leak key/body).
      throw new TelnyxRequestError(0, redactTelnyxError(err, this.#apiKey));
    }

    if (!res.ok) {
      let detail = `${method} ${path(url)} failed with ${res.status}`;
      try {
        const text = await res.text();
        if (text) detail = `${detail}: ${redactTelnyxError(text, this.#apiKey)}`;
      } catch {
        /* ignore body-read failure */
      }
      throw new TelnyxRequestError(res.status, detail);
    }

    return (await res.json()) as T;
  }
}

/** Strip the query string + origin from a URL for safe error messages (no key/filters echoed). */
function path(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '[url]';
  }
}

/**
 * Narrow structural slice of PrismaClient used by `assignNumberToAgent`. Loose arg types (`any`)
 * so both the real `PrismaClient` and a test mock satisfy it (mirrors lib/auth/agents.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ChannelPrisma {
  channel: {
    upsert(args: {
      where: { agentId_kind: { agentId: string; kind: ChannelKind } };
      update: any;
      create: any;
    }): Promise<{ id: string; agentId: string; kind: ChannelKind; phoneNumber: string | null }>;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Assign a provisioned DID to an agent's PHONE channel (DB-only — this part is SAFE, no spend).
 *
 * Upserts the unique (agentId, kind=PHONE) Channel row and writes `phoneNumber = did`. We do NOT
 * flip `enabled` here — going live is a separate, deliberate step. No PHI: a DID is not patient data.
 */
export async function assignNumberToAgent(
  prisma: ChannelPrisma,
  agentId: string,
  did: string,
): Promise<{ agentId: string; phoneNumber: string }> {
  const trimmed = did.trim();
  if (!trimmed) throw new Error('assignNumberToAgent: a DID is required.');

  const row = await prisma.channel.upsert({
    where: { agentId_kind: { agentId, kind: 'PHONE' } },
    update: { phoneNumber: trimmed },
    create: { agentId, kind: 'PHONE', phoneNumber: trimmed },
  });

  return { agentId, phoneNumber: row.phoneNumber ?? trimmed };
}
