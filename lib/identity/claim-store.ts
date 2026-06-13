/**
 * Server-side-only pending-claim store (T6, tk-0006).
 *
 * Between requestOtp and verifyOtp the raw IdentityClaim must live SOMEWHERE server-side, keyed by
 * the opaque challengeId — NEVER round-tripped through the browser or the model. This is a minimal,
 * in-process, TTL'd store for the single-tenant OSS demo. (A multi-instance deploy swaps this for a
 * shared server-side store — Lane F's concern; the interface here stays the same.)
 *
 * HARD RULE: nothing in here is ever logged or returned to a client. It is import-private to the
 * server. The challengeId is opaque (no PHI); the claim is PHI and stays here.
 */

import type { IdentityClaim } from '@/lib/identity/types';

interface StoredClaim {
  claim: IdentityClaim;
  expiresAtMs: number;
}

const DEFAULT_TTL_MS = 10 * 60_000; // 10 minutes — matches a typical OTP window with slack.

// Module-scoped: survives across requests within a single server process only.
const store = new Map<string, StoredClaim>();

function sweep(now: number): void {
  for (const [key, v] of store) {
    if (v.expiresAtMs <= now) store.delete(key);
  }
}

/** Stash a raw claim under its challengeId. Overwrites any prior entry for that id. */
export function putPendingClaim(challengeId: string, claim: IdentityClaim, ttlMs: number = DEFAULT_TTL_MS): void {
  const now = Date.now();
  sweep(now);
  store.set(challengeId, { claim, expiresAtMs: now + ttlMs });
}

/** Read (and KEEP) a pending claim, or null if absent/expired. */
export function getPendingClaim(challengeId: string): IdentityClaim | null {
  const entry = store.get(challengeId);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    store.delete(challengeId);
    return null;
  }
  return entry.claim;
}

/** Single-use consume: read and DELETE in one step (verify should not be replayable). */
export function consumePendingClaim(challengeId: string): IdentityClaim | null {
  const claim = getPendingClaim(challengeId);
  if (claim) store.delete(challengeId);
  return claim;
}

/** Test/maintenance helper — drop everything. */
export function clearPendingClaims(): void {
  store.clear();
}
