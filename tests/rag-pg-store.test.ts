/**
 * tk-0021 — IO-boundary test for the pgvector-backed RagStore (lib/rag/pg-store.ts).
 *
 * pg-store is the only place that talks raw SQL to the live DB for RAG (the embedding column is a
 * pgvector `Unsupported("vector(1536)")` type the typed Prisma client can't read/write). Per the
 * testing rule we do NOT hit a live DB: we inject a Prisma `$queryRawUnsafe` DOUBLE that records the
 * SQL text + bound params and replays scripted rows.
 *
 * Critical assertions:
 *   • insertChunk emits a parameterized INSERT into "ReferralResource" that mints the id in-statement
 *     (gen_random_uuid), binds tenantId + content + the vector LITERAL ($N::vector), and returns it.
 *   • The vector is serialized as the pgvector text literal "[a,b,c]" — never interpolated raw.
 *   • search emits the cosine-distance shape: score = 1 - ("embedding" <=> $vec), ORDER BY distance
 *     ASC (closest first), LIMIT topK, scoped to "tenantId" = $1, and only rows with a vector.
 *   • The optional language filter adds `AND "language" = $N::"Language"` and shifts topK's param.
 *   • Results below the advisory minScore are dropped; a string/Decimal score column is coerced.
 *   • DECISION-INERT / no-PHI: a returned citation carries only advisory display fields — no action /
 *     disposition / decision — and the store persists nothing beyond the public resource columns.
 *
 * No PHI: all fixtures are public-resource text.
 */
import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { pgStore } from '@/lib/rag/pg-store';
import type { ReferralCitation } from '@/lib/rag';

interface RawCall {
  sql: string;
  params: unknown[];
}

/**
 * Minimal `$queryRawUnsafe` double. pg-store only ever calls $queryRawUnsafe(sql, ...params); we
 * record each call and hand back a scripted result queue (FIFO). Cast to PrismaClient since the
 * store touches exactly this one method.
 */
function fakePrisma(results: unknown[][]): { client: PrismaClient; calls: RawCall[] } {
  const calls: RawCall[] = [];
  const queue = [...results];
  const client = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      return (queue.shift() ?? []) as unknown;
    },
  } as unknown as PrismaClient;
  return { client, calls };
}

/** Collapse SQL whitespace so structural assertions don't depend on indentation. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('pgStore.insertChunk — parameterized pgvector upsert', () => {
  it('mints the id in-statement, binds the public columns, and returns the new id', async () => {
    const { client, calls } = fakePrisma([[{ id: 'res-uuid-1' }]]);
    const store = pgStore(client);

    const out = await store.insertChunk({
      tenantId: 'tenant-A',
      title: 'Riverside Food Bank',
      body: 'Free groceries Tue/Thu 9am-1pm. Open to all.',
      category: 'food',
      language: 'EN',
      embedding: [0.1, 0.2, 0.3],
    });

    expect(out).toEqual({ id: 'res-uuid-1' });
    expect(calls).toHaveLength(1);
    const sql = flat(calls[0].sql);
    expect(sql).toContain('INSERT INTO "ReferralResource"');
    // id is generated DB-side, not bound — bypasses Prisma id gen for the Unsupported vector column.
    expect(sql).toContain('gen_random_uuid()::text');
    expect(sql).toContain('$6::vector');
    expect(sql).toContain('$5::"Language"');
    expect(sql).toContain('RETURNING "id"');
    // params are bound positionally: tenant, title, body, category, language, vector-literal.
    expect(calls[0].params).toEqual([
      'tenant-A',
      'Riverside Food Bank',
      'Free groceries Tue/Thu 9am-1pm. Open to all.',
      'food',
      'EN',
      '[0.1,0.2,0.3]',
    ]);
  });

  it('serializes the embedding as a pgvector text literal (never interpolated into the SQL)', async () => {
    const { client, calls } = fakePrisma([[{ id: 'res-uuid-2' }]]);
    const store = pgStore(client);

    await store.insertChunk({
      tenantId: 't1',
      title: 'Clinic',
      body: 'Walk-ins welcome.',
      category: null,
      language: 'ES',
      embedding: [1, -0.5, 0],
    });

    // the vector rides as a bound PARAM string, and the SQL text itself contains no number run.
    expect(calls[0].params[5]).toBe('[1,-0.5,0]');
    expect(calls[0].sql).not.toContain('[1,-0.5,0]');
    expect(calls[0].params[3]).toBeNull(); // category passes through as NULL
  });
});

describe('pgStore.search — cosine-distance similarity query', () => {
  it('emits the cosine-similarity SELECT scoped to the tenant, ordered closest-first, capped at topK', async () => {
    const { client, calls } = fakePrisma([
      [
        { id: 'r1', title: 'Food Bank', body: 'groceries', category: 'food', language: 'EN', score: 0.91 },
        { id: 'r2', title: 'Clinic', body: 'care', category: 'health', language: 'EN', score: 0.42 },
      ],
    ]);
    const store = pgStore(client);

    const hits = await store.search({
      tenantId: 'tenant-A',
      embedding: [0.1, 0.2],
      topK: 5,
      minScore: 0,
    });

    expect(calls).toHaveLength(1);
    const sql = flat(calls[0].sql);
    // similarity = 1 - cosine_distance (the `<=>` operator).
    expect(sql).toContain('1 - ("embedding" <=> $2::vector) AS "score"');
    expect(sql).toContain('FROM "ReferralResource"');
    // tenant scoping + only embedded rows.
    expect(sql).toContain('WHERE "tenantId" = $1 AND "embedding" IS NOT NULL');
    // closest-first ordering by raw distance, then a topK cap (no language → $3).
    expect(sql).toContain('ORDER BY "embedding" <=> $2::vector ASC');
    expect(sql).toContain('LIMIT $3');
    expect(calls[0].params).toEqual(['tenant-A', '[0.1,0.2]', 5]);

    // rows map straight to citations, preserving the DB ordering (no re-sort in the store).
    expect(hits.map((h) => h.id)).toEqual(['r1', 'r2']);
    expect(hits[0].score).toBe(0.91);
  });

  it('adds an AND "language" filter and shifts the topK param when a language is given', async () => {
    const { client, calls } = fakePrisma([[]]);
    const store = pgStore(client);

    await store.search({
      tenantId: 't1',
      embedding: [0.3],
      topK: 2,
      language: 'ES',
      minScore: 0,
    });

    const sql = flat(calls[0].sql);
    expect(sql).toContain('AND "language" = $3::"Language"');
    // with the language clause, topK is the 4th param.
    expect(sql).toContain('LIMIT $4');
    expect(calls[0].params).toEqual(['t1', '[0.3]', 'ES', 2]);
  });

  it('drops rows below the advisory minScore and coerces a string/Decimal score column to a number', async () => {
    const { client } = fakePrisma([
      [
        // raw SQL can hand back the computed column as a string/Decimal — exercise the coercion.
        { id: 'hi', title: 'A', body: 'b', category: null, language: 'EN', score: '0.80' },
        { id: 'lo', title: 'C', body: 'd', category: null, language: 'EN', score: '0.10' },
      ],
    ]);
    const store = pgStore(client);

    const hits = await store.search({
      tenantId: 't1',
      embedding: [0.9],
      topK: 10,
      minScore: 0.5,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('hi');
    expect(hits[0].score).toBe(0.8); // coerced from string
    expect(typeof hits[0].score).toBe('number');
  });
});

describe('pgStore — DECISION-INERT / no-PHI surface', () => {
  it('a returned citation carries only advisory display fields — no action / disposition / decision', async () => {
    const { client } = fakePrisma([
      [{ id: 'r1', title: 'Food Bank', body: 'groceries', category: 'food', language: 'EN', score: 0.7 }],
    ]);
    const store = pgStore(client);

    const [citation] = await store.search({ tenantId: 't1', embedding: [0.1], topK: 1, minScore: 0 });
    const keys = Object.keys(citation as ReferralCitation).sort();
    expect(keys).toEqual(['body', 'category', 'id', 'language', 'score', 'title']);
    expect(citation).not.toHaveProperty('action');
    expect(citation).not.toHaveProperty('disposition');
    expect(citation).not.toHaveProperty('decision');
  });

  it('persists only the public resource columns — no PHI sink (the INSERT binds nothing else)', async () => {
    const { client, calls } = fakePrisma([[{ id: 'res-1' }]]);
    const store = pgStore(client);

    await store.insertChunk({
      tenantId: 't1',
      title: 'Public Clinic',
      body: 'Sliding-scale primary care, walk-ins welcome.',
      category: 'health',
      language: 'EN',
      embedding: [0.4, 0.5],
    });

    // exactly the six public-resource params — no patient/identifier field can ride along.
    expect(calls[0].params).toHaveLength(6);
    const insertSql = flat(calls[0].sql);
    expect(insertSql).toContain('("id", "tenantId", "title", "body", "category", "language", "embedding", "createdAt")');
    // no PHI-bearing column names appear in the statement.
    expect(insertSql.toLowerCase()).not.toMatch(/patient|mrn|ssn|dob|"name"/);
  });
});
