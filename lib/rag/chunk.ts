/**
 * Deterministic chunker for referral-RAG ingest (T12). Splits a resource body into overlapping
 * windows so each chunk embeds independently and retrieval is granular. Pure — no AI, no DB.
 *
 * Determinism matters: the same body always yields the same chunks, so re-ingesting a resource is
 * idempotent and tests need no fuzzing. Boundaries prefer paragraph → sentence → hard cut, so a
 * chunk rarely splits mid-sentence.
 */

export interface ChunkOptions {
  /** Target max characters per chunk. */
  maxChars?: number;
  /** Characters of overlap carried from the end of one chunk into the next (context bleed). */
  overlap?: number;
}

export interface Chunk {
  index: number;
  text: string;
}

const DEFAULTS: Required<ChunkOptions> = { maxChars: 800, overlap: 100 };

/** Collapse runs of whitespace but keep paragraph breaks (double newline) as soft boundaries. */
function normalize(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split into paragraph-ish units; an over-long unit is further split on sentence enders. */
function segments(text: string): string[] {
  const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    if (p.length <= DEFAULTS.maxChars) {
      out.push(p);
    } else {
      // sentence-ish split, keeping the terminator with the sentence
      const sentences = p.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) ?? [p];
      for (const s of sentences) out.push(s.trim());
    }
  }
  return out.filter(Boolean);
}

export function chunkText(body: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULTS.maxChars;
  const overlap = Math.min(options.overlap ?? DEFAULTS.overlap, Math.floor(maxChars / 2));

  const normalized = normalize(body);
  if (normalized.length === 0) return [];
  if (normalized.length <= maxChars) return [{ index: 0, text: normalized }];

  const segs = segments(normalized);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    // carry an overlap tail into the next window
    current = overlap > 0 && trimmed.length > overlap ? trimmed.slice(-overlap) : '';
  };

  for (const seg of segs) {
    const candidate = current ? `${current} ${seg}` : seg;
    if (candidate.length > maxChars && current) {
      flush();
      current = current ? `${current} ${seg}` : seg;
    } else {
      current = candidate;
    }
    // a single segment longer than maxChars (after splitting) still gets hard-cut here
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars).trim());
      current = current.slice(maxChars - overlap);
    }
  }
  const tail = current.trim();
  if (tail) chunks.push(tail);

  // de-dupe immediate repeats that pure-overlap carry can produce, then index
  return chunks
    .filter((c, i) => i === 0 || c !== chunks[i - 1])
    .map((text, index) => ({ index, text }));
}
