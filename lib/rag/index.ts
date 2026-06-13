/**
 * Referral-RAG core (T12 / CAR-2391) — the ADVISORY, DECISION-INERT retrieval path.
 *
 * THE GUARANTEE (runbook + lane-f): this path can NEVER influence the deterministic disposition (π).
 * It is enforced STRUCTURALLY, not by convention:
 *   1. This module does not import — and cannot return — AllowedAction, PolicyDecision, RedFlagRule,
 *      RiskEstimate, or anything from '@/engine'. Retrieval returns ONLY a ReferralCitation[]
 *      (title/body/category/score). There is no code path here that yields a triage action.
 *   2. The result is consumed ONLY when an action has ALREADY been decided by the engine, and is
 *      rendered as a "you may also find this resource helpful" citation in a referral. See
 *      `buildReferralBlock` — it requires the caller to pass the engine's decided action in, and it
 *      returns display text, never an action.
 *   3. Ingest REJECTS PHI-shaped uploads (assertNoPhi) so the corpus never becomes a PHI sink.
 *
 * Storage: one Postgres + pgvector (OSS single-tenant law). The embedding column is a pgvector
 * `Unsupported` type, so reads/writes use parameterized raw SQL (the typed client can't see it).
 * The DB seam is injected so tests use a fake store and never touch a live DB or network.
 */
import type { Embedder } from './embeddings';
import { assertNoPhi } from './phi';
import { chunkText, type ChunkOptions } from './chunk';

export type ResourceLanguage = 'EN' | 'ES';

export interface IngestResourceInput {
  tenantId: string;
  title: string;
  body: string;
  category?: string;
  language?: ResourceLanguage;
}

/** A retrieved resource the agent may CITE in a referral. Note: no action/disposition field exists. */
export interface ReferralCitation {
  id: string;
  title: string;
  body: string;
  category: string | null;
  language: ResourceLanguage;
  /** Cosine similarity in [0,1]; higher = closer. Advisory ranking only. */
  score: number;
}

export interface RetrieveOptions {
  tenantId: string;
  query: string;
  topK?: number;
  language?: ResourceLanguage;
  /** Drop citations below this similarity (advisory threshold). */
  minScore?: number;
}

/**
 * The persistence seam. Two methods, both pgvector-aware. The production impl (pgStore) wraps Prisma
 * `$executeRaw`/`$queryRaw`; tests pass an in-memory fake.
 */
export interface RagStore {
  insertChunk(row: {
    tenantId: string;
    title: string;
    body: string;
    category: string | null;
    language: ResourceLanguage;
    embedding: number[];
  }): Promise<{ id: string }>;
  /** Cosine search scoped to a tenant; returns rows with a similarity score in [0,1]. */
  search(args: {
    tenantId: string;
    embedding: number[];
    topK: number;
    language?: ResourceLanguage;
    minScore: number;
  }): Promise<ReferralCitation[]>;
}

export interface RagDeps {
  store: RagStore;
  embed: Embedder;
  chunkOptions?: ChunkOptions;
}

export interface IngestResult {
  resourceIds: string[];
  chunkCount: number;
}

/**
 * Ingest a referral resource: REJECT PHI → chunk → embed → store. Each chunk becomes its own
 * ReferralResource row (granular retrieval). Throws PhiRejectedError if the upload is PHI-shaped.
 */
export async function ingestResource(
  input: IngestResourceInput,
  deps: RagDeps,
): Promise<IngestResult> {
  // 1. Safety gate — fail closed before anything is embedded or stored.
  assertNoPhi(input.title);
  assertNoPhi(input.body);

  const language = input.language ?? 'EN';
  const category = input.category ?? null;

  // 2. Chunk.
  const chunks = chunkText(input.body, deps.chunkOptions);
  if (chunks.length === 0) {
    return { resourceIds: [], chunkCount: 0 };
  }

  // 3. Embed (BYO key inside the embedder; never logged here).
  const vectors = await deps.embed(chunks.map((c) => c.text));

  // 4. Store each chunk as its own row.
  const resourceIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const { id } = await deps.store.insertChunk({
      tenantId: input.tenantId,
      // The first chunk keeps the resource title; later chunks are titled for provenance.
      title: chunks.length === 1 ? input.title : `${input.title} (${i + 1}/${chunks.length})`,
      body: chunks[i].text,
      category,
      language,
      embedding: vectors[i],
    });
    resourceIds.push(id);
  }

  return { resourceIds, chunkCount: chunks.length };
}

/**
 * Retrieve referral citations for a query. Embeds the query, runs a tenant-scoped cosine search,
 * returns the top-K citations. ADVISORY ONLY — the result carries no triage action and cannot
 * reach the adjudication path.
 */
export async function retrieveResources(
  opts: RetrieveOptions,
  deps: RagDeps,
): Promise<ReferralCitation[]> {
  const topK = opts.topK ?? 3;
  const minScore = opts.minScore ?? 0;
  const [queryVec] = await deps.embed([opts.query]);
  if (!queryVec) return [];
  return deps.store.search({
    tenantId: opts.tenantId,
    embedding: queryVec,
    topK,
    language: opts.language,
    minScore,
  });
}

/**
 * Render a referral block for display. The engine's decided action is passed IN as an opaque string
 * (we never compute it here) purely so the copy can say "because this was triaged as routine, here
 * are nearby resources". This function returns DISPLAY TEXT and citations — never an action. The
 * decision has already been made deterministically upstream; RAG only decorates the referral.
 */
export interface ReferralBlock {
  /** The action the ENGINE already decided — echoed for display, never produced here. */
  decidedAction: string;
  citations: ReferralCitation[];
  /** Advisory note rendered with the citations. */
  advisoryNote: string;
}

export function buildReferralBlock(args: {
  decidedAction: string;
  citations: ReferralCitation[];
  language?: ResourceLanguage;
}): ReferralBlock {
  const note =
    args.language === 'ES'
      ? 'Recursos comunitarios que podrían ser útiles. No modifican la recomendación clínica.'
      : 'Community resources you may find helpful. These do not change the clinical recommendation.';
  return {
    decidedAction: args.decidedAction,
    citations: args.citations,
    advisoryNote: note,
  };
}

export { assertNoPhi, scanForPhi, PhiRejectedError } from './phi';
export { chunkText } from './chunk';
export {
  createOpenAIEmbedder,
  isEmbeddingConfigured,
  getEmbeddingApiKey,
  EMBEDDING_DIM,
  type Embedder,
} from './embeddings';
export { pgStore } from './pg-store';
