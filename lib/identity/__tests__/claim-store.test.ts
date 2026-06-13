/**
 * Pending-claim store tests (T6) — single-use consume + TTL expiry. The store is server-side only;
 * these tests just verify it behaves (it is never serialized to a client/model anywhere in code).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  putPendingClaim,
  getPendingClaim,
  consumePendingClaim,
  clearPendingClaims,
} from '@/lib/identity/claim-store';
import { FIXTURE_CLAIM } from './_fixture-claim';

beforeEach(() => clearPendingClaims());
afterEach(() => vi.useRealTimers());

describe('claim-store', () => {
  it('stores and reads back a pending claim by challengeId', () => {
    putPendingClaim('chal-1', FIXTURE_CLAIM);
    expect(getPendingClaim('chal-1')).toEqual(FIXTURE_CLAIM);
  });

  it('consume is single-use: the second consume returns null', () => {
    putPendingClaim('chal-1', FIXTURE_CLAIM);
    expect(consumePendingClaim('chal-1')).toEqual(FIXTURE_CLAIM);
    expect(consumePendingClaim('chal-1')).toBeNull();
    expect(getPendingClaim('chal-1')).toBeNull();
  });

  it('expires after its TTL', () => {
    vi.useFakeTimers();
    putPendingClaim('chal-1', FIXTURE_CLAIM, 1000);
    vi.advanceTimersByTime(1001);
    expect(getPendingClaim('chal-1')).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(getPendingClaim('nope')).toBeNull();
  });
});
