/**
 * tk-0021 — IO-boundary test for the referral-RAG embedding provider (lib/rag/embeddings.ts).
 *
 * This is the BYO-key OpenAI-compatible HTTP boundary. Every test injects a MOCK fetch via the
 * `fetchImpl` seam — NO live network, NO real key (testing rule: "Never write a test that depends on
 * real network/PHI"; AGENTS.md §Security: the key is never logged/echoed/persisted).
 *
 * Critical assertions:
 *   • The request hits POST {baseUrl}/embeddings with the right model + input + dimensions.
 *   • The BYO Authorization header carries `Bearer <key>` (and nothing else leaks the key).
 *   • A 1536-dim vector is parsed back out of the provider's `data[].embedding` shape.
 *   • A missing OPENAI_API_KEY throws EmbeddingConfigError WITHOUT making any HTTP call — so
 *     resources still save (the ingest gate fails closed) while retrieval is disabled, matching the
 *     en.ts `resources.keyMissing` contract ("resources are stored either way").
 *   • A provider non-2xx is surfaced as a status-only error (never the body/headers/key).
 *   • A wrong-width provider vector is rejected by the frozen-schema shape guard.
 *
 * No PHI: fixtures are public-resource text only.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createOpenAIEmbedder,
  getEmbeddingApiKey,
  isEmbeddingConfigured,
  assertEmbeddingShape,
  EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  EmbeddingConfigError,
  EmbeddingDimensionError,
} from '@/lib/rag/embeddings';

// Non-secret-shaped test key per AGENTS.md — never a real `sk-...` literal.
const TEST_KEY = 'k'.repeat(20);

/** Build a minimal ProcessEnv for the injected-env seam (mirrors rag.test.ts's `as unknown` cast). */
const asEnv = (e: Record<string, string | undefined>) => e as unknown as NodeJS.ProcessEnv;

interface RecordedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A fetch double matching `typeof fetch`: records the call and replays a scripted Response-like
 * object (only the fields embeddings.ts reads: ok/status/statusText/json). First arg is the URL.
 */
function makeMockFetch(opts: {
  status?: number;
  statusText?: string;
  json?: unknown;
}): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const status = opts.status ?? 200;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: opts.statusText ?? 'OK',
      json: async () => opts.json ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

/** A well-formed provider response: one 1536-dim embedding per input text. */
function embeddingResponse(count: number): { data: { embedding: number[] }[] } {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      // deterministic, distinguishable per-row; width === frozen schema column.
      embedding: new Array(EMBEDDING_DIM).fill(0).map((_, j) => (j === i ? 1 : 0)),
    })),
  };
}

describe('getEmbeddingApiKey / isEmbeddingConfigured — BYO key gate (never echoed)', () => {
  it('reads a trimmed key from the injected env', () => {
    expect(getEmbeddingApiKey(asEnv({ OPENAI_API_KEY: `  ${TEST_KEY}  ` }))).toBe(TEST_KEY);
  });

  it('treats an unset or blank key as undefined (retrieval disabled, resources still save)', () => {
    expect(getEmbeddingApiKey(asEnv({}))).toBeUndefined();
    expect(getEmbeddingApiKey(asEnv({ OPENAI_API_KEY: '   ' }))).toBeUndefined();
    expect(isEmbeddingConfigured(asEnv({}))).toBe(false);
    expect(isEmbeddingConfigured(asEnv({ OPENAI_API_KEY: TEST_KEY }))).toBe(true);
  });
});

describe('createOpenAIEmbedder — request shape + BYO auth header', () => {
  it('POSTs {baseUrl}/embeddings with the default model, the input texts, and the frozen dimension', async () => {
    const { fetchImpl, requests } = makeMockFetch({ json: embeddingResponse(2) });
    const embed = createOpenAIEmbedder({
      env: asEnv({ OPENAI_API_KEY: TEST_KEY }),
      fetchImpl,
    });

    const texts = ['Riverside Food Bank: free groceries Tue/Thu.', 'Sliding-scale clinic, walk-ins welcome.'];
    await embed(texts);

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.url).toBe('https://api.openai.com/v1/embeddings');
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({
      model: DEFAULT_EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIM,
    });
  });

  it('sends the BYO key in the Authorization header as `Bearer <key>` and nowhere else', async () => {
    const { fetchImpl, requests } = makeMockFetch({ json: embeddingResponse(1) });
    const embed = createOpenAIEmbedder({
      env: asEnv({ OPENAI_API_KEY: TEST_KEY }),
      fetchImpl,
    });

    await embed(['Open to all community members.']);

    const req = requests[0];
    expect(req.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(req.headers['content-type']).toBe('application/json');
    // the key must never ride along in the URL or the JSON body.
    expect(req.url).not.toContain(TEST_KEY);
    expect(JSON.stringify(req.body)).not.toContain(TEST_KEY);
  });

  it('honors a custom baseUrl and model (OpenAI-compatible providers)', async () => {
    const { fetchImpl, requests } = makeMockFetch({ json: embeddingResponse(1) });
    const embed = createOpenAIEmbedder({
      env: asEnv({ OPENAI_API_KEY: TEST_KEY }),
      fetchImpl,
      baseUrl: 'https://proxy.internal/v1',
      model: 'text-embedding-3-large',
    });

    await embed(['Community resource listing.']);

    expect(requests[0].url).toBe('https://proxy.internal/v1/embeddings');
    expect((requests[0].body as { model: string }).model).toBe('text-embedding-3-large');
  });

  it('parses a 1536-dim vector per input out of the provider `data[].embedding` shape', async () => {
    const { fetchImpl } = makeMockFetch({ json: embeddingResponse(2) });
    const embed = createOpenAIEmbedder({
      env: asEnv({ OPENAI_API_KEY: TEST_KEY }),
      fetchImpl,
    });

    const vectors = await embed(['a', 'b']);
    expect(vectors).toHaveLength(2);
    vectors.forEach((v) => expect(v).toHaveLength(EMBEDDING_DIM));
    // the deterministic fixture sets index i hot for row i.
    expect(vectors[0][0]).toBe(1);
    expect(vectors[1][1]).toBe(1);
  });
});

describe('createOpenAIEmbedder — missing key (retrieval disabled, resources still save)', () => {
  it('throws EmbeddingConfigError and makes ZERO HTTP calls when OPENAI_API_KEY is unset', async () => {
    const fetchSpy = vi.fn();
    const embed = createOpenAIEmbedder({
      env: asEnv({}),
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    await expect(embed(['anything'])).rejects.toBeInstanceOf(EmbeddingConfigError);
    // the contract: no network is touched, so the failure is local to the embed step — the ingest
    // path can still persist resources (en.ts resources.keyMissing: "stored either way").
    expect(fetchSpy).not.toHaveBeenCalled();
    // and the error must point at the BYO env var without ever carrying a key value.
    await expect(embed(['anything'])).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('reads the key lazily at call time (a key set after construction works)', async () => {
    const env = asEnv({});
    const { fetchImpl, requests } = makeMockFetch({ json: embeddingResponse(1) });
    const embed = createOpenAIEmbedder({ env, fetchImpl });

    await expect(embed(['x'])).rejects.toBeInstanceOf(EmbeddingConfigError);
    env.OPENAI_API_KEY = TEST_KEY; // configured later
    await embed(['x']);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.authorization).toBe(`Bearer ${TEST_KEY}`);
  });
});

describe('createOpenAIEmbedder — error surfaces (status only, no leakage)', () => {
  it('surfaces a non-2xx as a status-only error (never the body or the key)', async () => {
    const { fetchImpl } = makeMockFetch({ status: 401, statusText: 'Unauthorized', json: {} });
    const embed = createOpenAIEmbedder({
      env: asEnv({ OPENAI_API_KEY: TEST_KEY }),
      fetchImpl,
    });

    await expect(embed(['x'])).rejects.toThrow(/Embedding request failed: 401 Unauthorized/);
    await expect(embed(['x'])).rejects.not.toThrow(new RegExp(TEST_KEY));
  });

  it('rejects a provider vector whose width != the frozen schema dimension', async () => {
    const { fetchImpl } = makeMockFetch({
      json: { data: [{ embedding: new Array(512).fill(0) }] }, // wrong width
    });
    const embed = createOpenAIEmbedder({
      env: asEnv({ OPENAI_API_KEY: TEST_KEY }),
      fetchImpl,
    });

    await expect(embed(['x'])).rejects.toBeInstanceOf(EmbeddingDimensionError);
  });

  it('tolerates a provider response missing `data` (returns no vectors rather than throwing)', async () => {
    const { fetchImpl } = makeMockFetch({ json: {} });
    const embed = createOpenAIEmbedder({
      env: asEnv({ OPENAI_API_KEY: TEST_KEY }),
      fetchImpl,
    });
    await expect(embed(['x'])).resolves.toEqual([]);
  });
});

describe('assertEmbeddingShape — frozen-schema width guard', () => {
  it('accepts 1536-dim vectors and rejects any other width', () => {
    expect(() => assertEmbeddingShape([new Array(EMBEDDING_DIM).fill(0)])).not.toThrow();
    expect(() => assertEmbeddingShape([new Array(EMBEDDING_DIM - 1).fill(0)])).toThrow(
      EmbeddingDimensionError,
    );
  });
});
