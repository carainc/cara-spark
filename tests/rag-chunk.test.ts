import { describe, it, expect } from 'vitest';
import { chunkText } from '@/lib/rag/chunk';

describe('chunkText — deterministic referral-RAG chunker (T12)', () => {
  it('empty / whitespace-only body → no chunks', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  \t ')).toEqual([]);
  });

  it('a short body → a single normalized chunk at index 0', () => {
    const out = chunkText('Food bank open Mon-Fri 9am.');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ index: 0, text: 'Food bank open Mon-Fri 9am.' });
  });

  it('normalizes whitespace (collapses spaces/tabs, trims)', () => {
    expect(chunkText('  Food   bank\t\topen.  ')[0].text).toBe('Food bank open.');
  });

  it('a long body → multiple sequentially-indexed chunks, each within maxChars', () => {
    const body = 'Sentence about the clinic. '.repeat(80); // ~2160 chars, one paragraph
    const out = chunkText(body, { maxChars: 200, overlap: 20 });
    expect(out.length).toBeGreaterThan(1);
    out.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.text.length).toBeLessThanOrEqual(200);
    });
  });

  it('is deterministic — identical input yields identical chunks', () => {
    const body = 'Para one is here.\n\n' + 'Long sentence here. '.repeat(60);
    expect(chunkText(body, { maxChars: 150 })).toEqual(chunkText(body, { maxChars: 150 }));
  });

  it('clamps overlap to at most half of maxChars (no infinite loop / oversized chunk)', () => {
    const out = chunkText('Word here. '.repeat(100), { maxChars: 50, overlap: 999 });
    expect(out.length).toBeGreaterThan(0);
    out.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(50));
  });

  it('does not emit immediate duplicate chunks', () => {
    const out = chunkText('Repeat this line. '.repeat(50), { maxChars: 40, overlap: 10 });
    for (let i = 1; i < out.length; i++) {
      expect(out[i].text).not.toBe(out[i - 1].text);
    }
  });
});
