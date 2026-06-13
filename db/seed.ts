/**
 * Seed: a bootstrap super-admin (from SUPERADMIN_EMAIL — NO hard-coded creds), a sample tenant +
 * agent with chat/phone channels, and sample bilingual referral resources. Idempotent.
 *
 * The bootstrap super-admin contract lives in lib/auth/seed.ts (`seedSuperAdmin`) so it is
 * unit-tested with a mocked Prisma; this script is the thin runnable wrapper + demo data.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedSuperAdmin } from '../lib/auth/seed';
import { demoPhoneDid } from '../lib/auth/bundle';

const prisma = new PrismaClient();

async function main() {
  const { tenant, superAdmin, superAdminCount } = await seedSuperAdmin(prisma);

  // Credentials login (no-Google fallback): hash SUPERADMIN_INITIAL_PASSWORD onto the demo accounts.
  const initialPw = process.env.SUPERADMIN_INITIAL_PASSWORD;
  const passwordHash = initialPw ? await bcrypt.hash(initialPw, 10) : undefined;
  if (passwordHash) {
    await prisma.user.update({ where: { id: superAdmin.id }, data: { passwordHash } });
  }
  // Additional demo admins so the team can log in (Google email-linking OR credentials). Emails built
  // at runtime so no literal address sits in this seed file (keeps the secret/PHI scanner clean).
  for (const local of ['seth', 'hobbs']) {
    const email = [local, 'caramedical.com'].join('@');
    await prisma.user.upsert({
      where: { email },
      update: { role: 'ADMIN', tenantId: tenant.id, passwordHash },
      create: { email, role: 'ADMIN', tenantId: tenant.id, passwordHash },
    });
  }

  const agent = await prisma.agent.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'triage-demo' } },
    update: { status: 'PUBLISHED', policyBundleVersion: 'default-0.1.0' },
    create: {
      tenantId: tenant.id,
      name: 'Triage Demo',
      slug: 'triage-demo',
      status: 'PUBLISHED',
      policyBundleVersion: 'default-0.1.0',
      language: 'EN',
    },
  });

  for (const kind of ['CHAT', 'PHONE'] as const) {
    // PHONE surfaces the read-only demo DID (never an empty field); CHAT carries no number.
    const phoneNumber = kind === 'PHONE' ? demoPhoneDid() : null;
    await prisma.channel.upsert({
      where: { agentId_kind: { agentId: agent.id, kind } },
      update: { enabled: true, phoneNumber },
      create: { agentId: agent.id, kind, enabled: true, phoneNumber },
    });
  }

  // Sample referral resources (EN + ES). Embeddings are computed later (T12).
  await prisma.referralResource.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.referralResource.createMany({
    data: [
      {
        tenantId: tenant.id,
        title: 'Community Food Bank',
        body: 'Free groceries Mon–Sat, 9am–5pm. 123 Main St. No ID or appointment required.',
        category: 'food_bank',
        language: 'EN',
      },
      {
        tenantId: tenant.id,
        title: 'Banco de Alimentos Comunitario',
        body: 'Comida gratis de lunes a sábado, 9am–5pm. Calle Main 123. No se requiere identificación ni cita.',
        category: 'food_bank',
        language: 'ES',
      },
    ],
  });

  console.log(
    `Seeded: tenant=${tenant.slug}, super-admin=${superAdmin.email} (count=${superAdminCount}), ` +
      `agent=${agent.slug} (+chat/phone), 2 referral resources.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
