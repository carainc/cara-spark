/**
 * Opaque-ref tests (T6) — the ref is CSPRNG-random, prefixed, PHI-free, and unique per mint.
 */
import { describe, it, expect } from 'vitest';
import { mintOpaqueRef, isOpaqueRef, OPAQUE_REF_PREFIX } from '@/lib/identity/opaque-ref';
import { FIXTURE_IDENTIFIERS } from './_fixture-claim';

describe('mintOpaqueRef', () => {
  it('is prefixed and recognized by isOpaqueRef', () => {
    const ref = mintOpaqueRef();
    expect(ref.startsWith(OPAQUE_REF_PREFIX)).toBe(true);
    expect(isOpaqueRef(ref)).toBe(true);
  });

  it('is unique across many mints (random, not derived)', () => {
    const set = new Set(Array.from({ length: 1000 }, () => mintOpaqueRef()));
    expect(set.size).toBe(1000);
  });

  it('encodes none of the fixture identifiers (it takes no claim input)', () => {
    const ref = mintOpaqueRef();
    for (const identifier of FIXTURE_IDENTIFIERS) {
      expect(ref).not.toContain(identifier);
    }
  });

  it('isOpaqueRef rejects obvious non-refs', () => {
    expect(isOpaqueRef('')).toBe(false);
    expect(isOpaqueRef('idr_')).toBe(false);
    expect(isOpaqueRef('Wendeline Quackenbush')).toBe(false);
  });
});
