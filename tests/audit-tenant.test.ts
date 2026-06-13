import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the session + DB singletons this module reaches for (no network, no real DB).
const { authSpy, findUniqueSpy } = vi.hoisted(() => ({ authSpy: vi.fn(), findUniqueSpy: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: authSpy }));
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: findUniqueSpy } } }));

import { getActiveTenantId } from '@/lib/audit/tenant';

describe('getActiveTenantId — read-side tenant scoping (T11/T12)', () => {
  beforeEach(() => {
    authSpy.mockReset();
    findUniqueSpy.mockReset();
  });

  it('no session → null, and never queries the DB', async () => {
    authSpy.mockResolvedValue(null);
    expect(await getActiveTenantId()).toBeNull();
    expect(findUniqueSpy).not.toHaveBeenCalled();
  });

  it('session present but user has no tenant → null', async () => {
    authSpy.mockResolvedValue({ user: { id: 'u1' } });
    findUniqueSpy.mockResolvedValue({ tenantId: null });
    expect(await getActiveTenantId()).toBeNull();
  });

  it('session + user assigned a tenant → that tenant id', async () => {
    authSpy.mockResolvedValue({ user: { id: 'u1' } });
    findUniqueSpy.mockResolvedValue({ tenantId: 'tenant_demo' });
    expect(await getActiveTenantId()).toBe('tenant_demo');
  });
});
