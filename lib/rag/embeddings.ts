/**
 * Embedding provider for referral-RAG (T12). BYO key: the key is read from the environment
 * (OPENAI_API_KEY) and NEVER logged, echoed, or persisted (AGENTS.md §Security). The embedder is an
 * injectable seam so tests pass a deterministic fake and never hit the network (testing rule:
 * "Never write a test that depends on real network/PHI").
 *
 * The vector dimension is FROZEN by the schema: ReferralResource.embedding is vector(1536). The
 * default model (text-embedding-3-small) returns 1536 dims, matching the column.
 */

/** The pgvector column width — must match db/schema.prisma `Unsupported("vector(1536)")`. */
export const EMBEDDING_DIM = 1536;
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/** An embedder turns texts into fixed-width vectors. Real impl calls the provider; tests fake it. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

export class EmbeddingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingConfigError';
  }
}

export class EmbeddingDimensionError extends Error {
  constructor(got: number, expected: number) {
    super(`Embedding dimension mismatch: provider returned ${got}, schema expects ${expected}.`);
    this.name = 'EmbeddingDimensionError';
  }
}

/** Read the BYO key from env. Returns undefined if unset — callers decide how to fail. NEVER logged. */
export function getEmbeddingApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.OPENAI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

/** True iff a BYO embedding key is configured. UI uses this to gate the upload affordance. */
export function isEmbeddingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getEmbeddingApiKey(env) !== undefined;
}

/** Validate provider output width against the frozen schema column. */
export function assertEmbeddingShape(vectors: number[][]): void {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) throw new EmbeddingDimensionError(v.length, EMBEDDING_DIM);
  }
}

/**
 * The real OpenAI-compatible embedder. Lazily reads the key at call time (never at import) so a
 * missing key only fails the ingest path, not the whole module. The key is sent in the Authorization
 * header only — it is never placed in a log line, error message, or the returned data.
 */
export function createOpenAIEmbedder(opts?: {
  model?: string;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Embedder {
  const model = opts?.model ?? DEFAULT_EMBEDDING_MODEL;
  const baseUrl = opts?.baseUrl ?? 'https://api.openai.com/v1';
  const doFetch = opts?.fetchImpl ?? fetch;

  return async (texts: string[]): Promise<number[][]> => {
    const apiKey = getEmbeddingApiKey(opts?.env);
    if (!apiKey) {
      throw new EmbeddingConfigError(
        'OPENAI_API_KEY is not set. Referral-resource embedding requires a BYO embedding key (see .env.example).',
      );
    }
    const res = await doFetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Key lives ONLY in this header — never logged.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIM }),
    });
    if (!res.ok) {
      // Deliberately do NOT include the request body/headers — only the status.
      throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data?: { embedding: number[] }[] };
    const vectors = (json.data ?? []).map((d) => d.embedding);
    assertEmbeddingShape(vectors);
    return vectors;
  };
}
