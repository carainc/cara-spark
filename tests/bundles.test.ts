import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listPolicyBundles,
  isKnownBundleVersion,
  bundleVerifiedLabel,
  DEFAULT_POLICY_BUNDLE_VERSION,
} from '@/lib/auth/bundle';
import { setAgentPolicyBundle, type AgentPrisma, type AgentRow } from '@/lib/auth/agents';

/**
 * tk-0017 / tk-0022 — the SIGNED policy-bundle catalog + selector. The bundle is the safety
 * contract: the catalog must expose REAL engine-verified metadata (checksum/signature), and the
 * write path must be fail-closed on an unknown version so a tampered form value can never become
 * an agent's policy. The engine itself is covered by the engine suite; here we test the seam.
 */
describe('listPolicyBundles — surfaces the signed default with engine-verified metadata', () => {
  afterEach(() => {
    delete process.env.VOICE_CONFIG_HMAC_SECRET;
  });

  it('returns the default bundle under the DB version string', () => {
    const bundles = listPolicyBundles();
    expect(bundles).toHaveLength(1);
    const b = bundles[0];
    expect(b.version).toBe(DEFAULT_POLICY_BUNDLE_VERSION);
    expect(b.isDefault).toBe(true);
    // policyVersion is the engine's internal metadata version (distinct from the DB label).
    expect(b.policyVersion).toBe('1.0.0');
    expect(b.signedBy).toBe('cara-spark-default');
  });

  it('reports a valid checksum and a real (non-empty) checksum value', () => {
    const b = listPolicyBundles()[0];
    expect(b.checksum).toMatch(/^[0-9a-f]{16,}$/i);
    expect(b.checksumValid).toBe(true);
  });

  it('summarizes the red-flag rules the bundle escalates (id/name/action only)', () => {
    const b = listPolicyBundles()[0];
    expect(b.redFlagRules.length).toBeGreaterThan(0);
    for (const r of b.redFlagRules) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.name).toBe('string');
      expect(typeof r.action).toBe('string');
    }
    // It must NOT leak thresholds or mutable internals into the summary.
    expect(Object.keys(b.redFlagRules[0]).sort()).toEqual(['action', 'id', 'name']);
  });

  it('is unsigned without a secret, signature-verified once VOICE_CONFIG_HMAC_SECRET is set', () => {
    expect(listPolicyBundles()[0].signatureValid).toBe(false);
    process.env.VOICE_CONFIG_HMAC_SECRET = 'unit-test-hmac-fixture';
    expect(listPolicyBundles()[0].signatureValid).toBe(true);
  });
});

describe('isKnownBundleVersion + bundleVerifiedLabel', () => {
  it('recognizes the default version and rejects anything else', () => {
    expect(isKnownBundleVersion(DEFAULT_POLICY_BUNDLE_VERSION)).toBe(true);
    expect(isKnownBundleVersion('totally-made-up')).toBe(false);
    expect(isKnownBundleVersion('')).toBe(false);
  });

  it('renders the verified badge label', () => {
    expect(bundleVerifiedLabel()).toContain(DEFAULT_POLICY_BUNDLE_VERSION);
    expect(bundleVerifiedLabel()).toContain('verified');
  });
});

describe('setAgentPolicyBundle — guarded + fail-closed on an unknown version', () => {
  function mockDb(): { db: AgentPrisma; update: ReturnType<typeof vi.fn> } {
    const update = vi.fn(async ({ data }: { data: { policyBundleVersion: string } }) => ({
      id: 'agent_1',
      tenantId: 't1',
      name: 'A',
      slug: 'a',
      status: 'DRAFT',
      language: 'EN',
      policyBundleVersion: data.policyBundleVersion,
    }) as AgentRow);
    return {
      update,
      db: { agent: { create: vi.fn(), update, findUnique: vi.fn() }, channel: { upsert: vi.fn() } } as unknown as AgentPrisma,
    };
  }

  it('writes the version for an authorized actor + a known bundle', async () => {
    const { db, update } = mockDb();
    const row = await setAgentPolicyBundle(db, {
      actorRole: 'ADMIN',
      agentId: 'agent_1',
      policyBundleVersion: DEFAULT_POLICY_BUNDLE_VERSION,
    });
    expect(row.policyBundleVersion).toBe(DEFAULT_POLICY_BUNDLE_VERSION);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'agent_1' },
      data: { policyBundleVersion: DEFAULT_POLICY_BUNDLE_VERSION },
    });
  });

  it('rejects an unknown version WITHOUT writing (fail-closed)', async () => {
    const { db, update } = mockDb();
    await expect(
      setAgentPolicyBundle(db, { actorRole: 'ADMIN', agentId: 'agent_1', policyBundleVersion: 'evil-bundle' }),
    ).rejects.toThrow(/Unknown policy bundle/);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an actor without manage capability', async () => {
    const { db, update } = mockDb();
    await expect(
      setAgentPolicyBundle(db, { actorRole: null, agentId: 'agent_1', policyBundleVersion: DEFAULT_POLICY_BUNDLE_VERSION }),
    ).rejects.toThrow(/Forbidden/);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('GET /api/bundles — session-guarded read of the bundle catalog', () => {
  const authSpy = vi.hoisted(() => vi.fn());
  beforeEach(() => {
    vi.resetModules();
    authSpy.mockReset();
    vi.doMock('@/lib/auth', () => ({ auth: authSpy }));
  });
  afterEach(() => {
    vi.doUnmock('@/lib/auth');
  });

  it('401 when there is no session', async () => {
    authSpy.mockResolvedValue(null);
    const { GET } = await import('@/app/api/bundles/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 returns the bundle catalog for a signed-in user', async () => {
    authSpy.mockResolvedValue({ user: { id: 'u1', tenantId: 't1', role: 'EDITOR' } });
    const { GET } = await import('@/app/api/bundles/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bundles: { version: string; checksumValid: boolean }[] };
    expect(body.bundles).toHaveLength(1);
    expect(body.bundles[0].version).toBe(DEFAULT_POLICY_BUNDLE_VERSION);
    expect(body.bundles[0].checksumValid).toBe(true);
  });
});
