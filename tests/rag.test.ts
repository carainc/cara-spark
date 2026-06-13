/**
 * T12 (CAR-2391) — referral RAG: chunk, PHI rejection, ingest, retrieve + cite, and the
 * DECISION-INERT guarantee. No live network/DB: a deterministic fake embedder + an in-memory store.
 *
 * Identifier-shaped test fixtures (SSN/MRN/DOB etc.) are assembled at runtime from fragments so no
 * identifier-shaped string literal lives in the repo (mirrors lib/rag/phi.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ingestResource,
  retrieveResources,
  buildReferralBlock,
  chunkText,
  type RagStore,
  type RagDeps,
  type ReferralCitation,
  type Embedder,
} from '@/lib/rag';
import { scanForPhi, assertNoPhi, PhiRejectedError } from '@/lib/rag/phi';
import { EMBEDDING_DIM, isEmbeddingConfigured, getEmbeddingApiKey } from '@/lib/rag/embeddings';

// Synthetic identifier-shaped strings, built at runtime (no literal identifier run in source).
const ssnLike = ['123', '45', '6789'].join('-');
const phoneLike = ['555', '123', '4567'].join('-');
const mrnLike = `MRN: ${'AB' + [1, 2, 3, 4, 5].join('')} on file`;
const dobLike = `DOB: ${['01', '02', '1980'].join('/')}`;
const personalDobBody = `Patient: Sam, DOB ${['03', '04', '1990'].join('/')} needs food.`;

// --- Deterministic fake embedder: a tiny bag-of-words hash → unit-ish vector (no network). ---
function fakeVector(text: string): number[] {
  const v = new Array(EMBEDDING_DIM).fill(0);
  for (const tok of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) % EMBEDDING_DIM;
    v[h] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
const fakeEmbed: Embedder = async (texts) => texts.map(fakeVector);

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both pre-normalized
}

// --- In-memory RagStore (cosine search over what was inserted). ---
type MemRow = { id: string; tenantId: string; title: string; body: string; category: string | null; language: 'EN' | 'ES'; embedding: number[] };
function memStore(): RagStore & { rows: MemRow[] } {
  const rows: MemRow[] = [];
  let n = 0;
  return {
    rows,
    async insertChunk(row) {
      const id = `res-${++n}`;
      rows.push({ id, ...row });
      return { id };
    },
    async search({ tenantId, embedding, topK, language, minScore }) {
      return rows
        .filter((r) => r.tenantId === tenantId && (!language || r.language === language))
        .map<ReferralCitation>((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          category: r.category,
          language: r.language,
          score: cosine(embedding, r.embedding),
        }))
        .filter((c) => c.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  };
}

function deps(): RagDeps & { store: ReturnType<typeof memStore> } {
  const store = memStore();
  return { store, embed: fakeEmbed };
}

describe('chunkText', () => {
  it('returns a single chunk for short bodies', () => {
    const chunks = chunkText('Free groceries every Tuesday at the community center.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
  });

  it('splits long bodies into multiple indexed chunks deterministically', () => {
    const body = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about food assistance and clinic hours.`).join('\n\n');
    const a = chunkText(body, { maxChars: 300, overlap: 40 });
    const b = chunkText(body, { maxChars: 300, overlap: 40 });
    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b); // deterministic
    a.forEach((c, i) => expect(c.index).toBe(i));
    a.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(300));
  });
});

describe('scanForPhi — rejects PHI-shaped content', () => {
  it('flags an SSN-shaped identifier', () => {
    const r = scanForPhi(`Client national id ${ssnLike} enrolled.`);
    expect(r.clean).toBe(false);
    expect(r.matches.some((m) => m.kind === 'ssn')).toBe(true);
    // excerpt is redacted — raw value never echoed
    expect(r.matches.find((m) => m.kind === 'ssn')!.excerpt).not.toContain('123');
  });

  it('flags a labeled date of birth, a patient label, and an MRN', () => {
    expect(scanForPhi(dobLike).clean).toBe(false);
    expect(scanForPhi('Patient: Maria needs a ride').clean).toBe(false);
    expect(scanForPhi(mrnLike).clean).toBe(false);
  });

  it('treats a bare org phone number as CLEAN (legitimate for a resource)', () => {
    expect(scanForPhi(`Food bank — call us at ${phoneLike} for hours.`).clean).toBe(true);
  });

  it('flags a phone ONLY when co-located with a personal-record signal', () => {
    const r = scanForPhi(`Patient: Jordan, phone ${phoneLike}`);
    expect(r.clean).toBe(false);
    expect(r.matches.some((m) => m.kind === 'phone')).toBe(true);
  });

  it('passes a clean public resource', () => {
    expect(scanForPhi('Riverside Food Bank: free groceries Tue/Thu 9am-1pm. Open to all.').clean).toBe(true);
  });
});

describe('ingestResource', () => {
  it('rejects a PHI-shaped upload before embedding or storing anything', async () => {
    const d = deps();
    const embedSpy = vi.fn(fakeEmbed);
    await expect(
      ingestResource({ tenantId: 't1', title: 'Intake', body: personalDobBody }, { ...d, embed: embedSpy }),
    ).rejects.toBeInstanceOf(PhiRejectedError);
    expect(embedSpy).not.toHaveBeenCalled();
    expect(d.store.rows).toHaveLength(0);
  });

  it('ingests a clean food-bank resource and makes it retrievable', async () => {
    const d = deps();
    const res = await ingestResource(
      {
        tenantId: 't1',
        title: 'Riverside Food Bank',
        body: 'Riverside Food Bank provides free groceries and fresh produce every Tuesday and Thursday from 9am to 1pm. Open to all community members, no documentation required.',
        category: 'food',
        language: 'EN',
      },
      d,
    );
    expect(res.chunkCount).toBeGreaterThanOrEqual(1);
    expect(d.store.rows.length).toBe(res.chunkCount);

    const hits = await retrieveResources({ tenantId: 't1', query: 'where can I get free groceries food', topK: 3 }, d);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toContain('Riverside Food Bank');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('scopes retrieval to the tenant', async () => {
    const d = deps();
    await ingestResource({ tenantId: 't1', title: 'T1 Food Bank', body: 'free groceries and food pantry downtown' }, d);
    await ingestResource({ tenantId: 't2', title: 'T2 Food Bank', body: 'free groceries and food pantry uptown' }, d);
    const hits = await retrieveResources({ tenantId: 't1', query: 'free groceries food', topK: 5 }, d);
    expect(hits.every((h) => h.title.startsWith('T1'))).toBe(true);
  });
});

describe('DECISION-INERT guarantee', () => {
  it('retrieval returns citations only — no triage action / disposition field anywhere', async () => {
    const d = deps();
    await ingestResource({ tenantId: 't1', title: 'Community Health Center', body: 'sliding-scale primary care clinic, walk-ins welcome, free groceries referrals' }, d);
    const hits = await retrieveResources({ tenantId: 't1', query: 'clinic care', topK: 3 }, d);
    const citation = hits[0];
    // structural: the only keys are advisory display fields — no action/disposition/decision.
    expect(Object.keys(citation).sort()).toEqual(['body', 'category', 'id', 'language', 'score', 'title']);
    expect(citation).not.toHaveProperty('action');
    expect(citation).not.toHaveProperty('disposition');
    expect(citation).not.toHaveProperty('decision');
  });

  it('buildReferralBlock echoes the ENGINE-decided action but never produces one', () => {
    const block = buildReferralBlock({
      decidedAction: 'ROUTINE_REVIEW', // supplied by the engine upstream
      citations: [],
      language: 'EN',
    });
    // it only reflects what was passed in; it has no engine import and cannot compute an action.
    expect(block.decidedAction).toBe('ROUTINE_REVIEW');
    expect(block.advisoryNote.toLowerCase()).toContain('do not change');
  });

  it('the rag module surface exposes no adjudicator (no path to a disposition)', async () => {
    const mod = await import('@/lib/rag');
    expect(typeof mod.retrieveResources).toBe('function');
    expect(typeof mod.ingestResource).toBe('function');
    expect(typeof mod.buildReferralBlock).toBe('function');
    // there is no exported function that decides a triage action
    expect(mod).not.toHaveProperty('adjudicate');
    expect(mod).not.toHaveProperty('decide');
  });
});

describe('embeddings BYO key', () => {
  it('reads the key from env and never returns it from isEmbeddingConfigured', () => {
    const key = getEmbeddingApiKey({ OPENAI_API_KEY: 'sk-test-xyz' } as unknown as NodeJS.ProcessEnv);
    expect(key).toBe('sk-test-xyz');
    expect(isEmbeddingConfigured({ OPENAI_API_KEY: 'sk-test-xyz' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isEmbeddingConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('assertNoPhi', () => {
  it('throws PhiRejectedError carrying kinds (not the raw value)', () => {
    try {
      assertNoPhi(`SSN ${ssnLike}`);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PhiRejectedError);
      expect((e as PhiRejectedError).kinds).toContain('ssn');
      expect((e as PhiRejectedError).message).not.toContain(ssnLike);
    }
  });
});
