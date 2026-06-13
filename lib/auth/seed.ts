/**
 * Bootstrap seed (T14 / Lane E). A FRESH deploy seeds EXACTLY ONE super-admin — and its identity
 * comes from SUPERADMIN_EMAIL only (NO hard-coded credentials, OSS law #6). Idempotent: re-running
 * upserts the same single super-admin, never a second one.
 *
 * Extracted from db/seed.ts so the env-bootstrap contract is unit-testable with a mocked Prisma
 * (no network). db/seed.ts is the thin runnable wrapper around `seedSuperAdmin`.
 */
import type { Role } from '@prisma/client';

export interface SeedTenantRow {
  id: string;
  slug: string;
  name: string;
}
export interface SeedUserRow {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SeedPrisma {
  tenant: {
    upsert(args: { where: any; update: any; create: any }): Promise<SeedTenantRow>;
  };
  user: {
    upsert(args: { where: any; update: any; create: any }): Promise<SeedUserRow>;
    count(args?: { where?: { role: Role } }): Promise<number>;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SeedResult {
  tenant: SeedTenantRow;
  superAdmin: SeedUserRow;
  superAdminCount: number;
}

/**
 * Seed the demo tenant + the single bootstrap super-admin from env. Throws if SUPERADMIN_EMAIL is
 * missing — there is no fallback credential. Returns the super-admin and the live count of
 * SUPER_ADMIN rows so callers (and tests) can assert there is exactly one.
 */
export async function seedSuperAdmin(
  db: SeedPrisma,
  env: { SUPERADMIN_EMAIL?: string } = process.env as { SUPERADMIN_EMAIL?: string },
): Promise<SeedResult> {
  const superEmail = env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  if (!superEmail) {
    throw new Error('SUPERADMIN_EMAIL is required to seed the bootstrap super-admin (no hard-coded creds).');
  }

  const tenant = await db.tenant.upsert({
    where: { slug: 'demo-chc' },
    update: {},
    create: { name: 'Demo Community Health Center', slug: 'demo-chc', defaultLanguage: 'EN' },
  });

  const superAdmin = await db.user.upsert({
    where: { email: superEmail },
    update: { role: 'SUPER_ADMIN', tenantId: tenant.id },
    create: { email: superEmail, role: 'SUPER_ADMIN', tenantId: tenant.id },
  });

  const superAdminCount = await db.user.count({ where: { role: 'SUPER_ADMIN' } });
  return { tenant, superAdmin, superAdminCount };
}
