import { describe, it, expect } from 'vitest';
import { resolveBundle } from '@/lib/audit/bundle-resolver';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';

describe('resolveBundle — re-verify a recorded decision against its bundle (T11)', () => {
  it('resolves the DEFAULT bundle version to DEFAULT_POLICY', () => {
    expect(resolveBundle(DEFAULT_POLICY.metadata.policyVersion)).toBe(DEFAULT_POLICY);
  });

  it('returns null for an unknown version (viewer then shows "not re-verifiable here")', () => {
    expect(resolveBundle('v0.0.0-does-not-exist')).toBeNull();
    expect(resolveBundle('')).toBeNull();
  });
});
