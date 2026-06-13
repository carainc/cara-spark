import { describe, it, expect, beforeEach } from 'vitest';
import { seedSuperAdmin, type SeedPrisma, type SeedUserRow } from '@/lib/auth/seed';
import type { Role } from '@prisma/client';

/** In-memory Prisma double for the bootstrap seed — no network, no real DB. */
function makeDb() {
  const tenants = new Map<string, { id: string; slug: string; name: string }>();
  const users = new Map<string, SeedUserRow>();
  let seq = 0;

  const db: SeedPrisma = {
    tenant: {
      async upsert({ where, create }) {
        const existing = tenants.get(where.slug);
        if (existing) return existing;
        const row = { id: `tenant_${++seq}`, slug: where.slug, name: create.name as string };
        tenants.set(where.slug, row);
        return row;
      },
    },
    user: {
      async upsert({ where, update, create }) {
        const existing = users.get(where.email);
        if (existing) {
          existing.role = (update.role as Role) ?? existing.role;
          existing.tenantId = (update.tenantId as string) ?? existing.tenantId;
          return existing;
        }
        const row: SeedUserRow = {
          id: `user_${++seq}`,
          email: where.email,
          role: create.role as Role,
          tenantId: (create.tenantId as string) ?? null,
        };
        users.set(where.email, row);
        return row;
      },
      async count(args) {
        const role = args?.where?.role;
        return [...users.values()].filter((u) => (role ? u.role === role : true)).length;
      },
    },
  };
  return { db, tenants, users };
}

describe('fresh deploy seeds exactly one super-admin from env (no hard-coded creds)', () => {
  let store: ReturnType<typeof makeDb>;
  beforeEach(() => {
    store = makeDb();
  });

  it('seeds exactly one SUPER_ADMIN whose email comes from SUPERADMIN_EMAIL', async () => {
    const result = await seedSuperAdmin(store.db, { SUPERADMIN_EMAIL: 'Boss@Example.org' });
    expect(result.superAdmin.email).toBe('boss@example.org'); // normalized, from env
    expect(result.superAdmin.role).toBe('SUPER_ADMIN');
    expect(result.superAdmin.tenantId).toBe(result.tenant.id);
    expect(result.superAdminCount).toBe(1);
  });

  it('throws when SUPERADMIN_EMAIL is missing — there is no fallback credential', async () => {
    await expect(seedSuperAdmin(store.db, {})).rejects.toThrow(/SUPERADMIN_EMAIL is required/i);
    expect(store.users.size).toBe(0);
  });

  it('is idempotent — re-running keeps exactly one super-admin', async () => {
    await seedSuperAdmin(store.db, { SUPERADMIN_EMAIL: 'boss@example.org' });
    const second = await seedSuperAdmin(store.db, { SUPERADMIN_EMAIL: 'boss@example.org' });
    expect(second.superAdminCount).toBe(1);
    expect(store.users.size).toBe(1);
  });
});
