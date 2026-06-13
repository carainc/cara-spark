/**
 * pgvector-backed RagStore (T12). The ReferralResource.embedding column is a pgvector
 * `Unsupported("vector(1536)")` type — the Prisma typed client cannot read or write it, so we use
 * parameterized raw SQL. Cosine distance is the `<=>` operator; similarity = 1 - distance.
 *
 * One Postgres + pgvector (OSS single-tenant law) — no separate vector DB. Tenant-scoped queries
 * keep one CHC's corpus from leaking into another's referrals.
 *
 * This file is the only place that talks to the live DB for RAG; lib/rag/index.ts stays
 * DB-agnostic behind the RagStore seam so its logic is unit-tested with a fake.
 */
import type { PrismaClient } from '@prisma/client';
import type { RagStore, ReferralCitation, ResourceLanguage } from './index';

/** Serialize a JS number[] into the pgvector text literal form: "[0.1,0.2,...]". */
function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

interface SearchRow {
  id: string;
  title: string;
  body: string;
  category: string | null;
  language: ResourceLanguage;
  score: number;
}

/**
 * Build the pgvector RagStore. `prisma` is injected so the same impl works in app code and in an
 * integration test against a throwaway test DB (no live network; testing rule).
 */
export function pgStore(prisma: PrismaClient): RagStore {
  return {
    async insertChunk(row) {
      const vec = toVectorLiteral(row.embedding);
      // Raw SQL bypasses Prisma id generation, so we mint a UUID in-statement and read it back.
      const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO "ReferralResource" ("id", "tenantId", "title", "body", "category", "language", "embedding", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::"Language", $6::vector, now())
         RETURNING "id"`,
        row.tenantId,
        row.title,
        row.body,
        row.category,
        row.language,
        vec,
      );
      return { id: rows[0].id };
    },

    async search({ tenantId, embedding, topK, language, minScore }) {
      const vec = toVectorLiteral(embedding);
      // 1 - cosine_distance = cosine_similarity. Filter by tenant (+ optional language), order by
      // distance ascending (closest first), cap at topK, then drop below the advisory minScore.
      const langClause = language ? `AND "language" = $3::"Language"` : '';
      const params: unknown[] = language ? [tenantId, vec, language, topK] : [tenantId, vec, topK];
      const topKParam = language ? '$4' : '$3';
      const rows = await prisma.$queryRawUnsafe<SearchRow[]>(
        `SELECT "id", "title", "body", "category", "language",
                1 - ("embedding" <=> $2::vector) AS "score"
         FROM "ReferralResource"
         WHERE "tenantId" = $1 AND "embedding" IS NOT NULL ${langClause}
         ORDER BY "embedding" <=> $2::vector ASC
         LIMIT ${topKParam}`,
        ...params,
      );
      const citations: ReferralCitation[] = rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        category: r.category,
        language: r.language,
        // raw SQL can hand back a string/Decimal for the computed column — coerce to number.
        score: typeof r.score === 'number' ? r.score : Number(r.score),
      }));
      return citations.filter((c) => c.score >= minScore);
    },
  };
}
