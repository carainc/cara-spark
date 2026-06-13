/**
 * Seed: a bootstrap super-admin (from SUPERADMIN_EMAIL — NO hard-coded creds), a sample tenant +
 * agent with chat/phone channels, and sample bilingual referral resources. Idempotent.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const superEmail = process.env.SUPERADMIN_EMAIL?.toLowerCase();
  if (!superEmail) throw new Error('SUPERADMIN_EMAIL is required to seed the bootstrap super-admin.');

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-chc' },
    update: {},
    create: { name: 'Demo Community Health Center', slug: 'demo-chc', defaultLanguage: 'EN' },
  });

  await prisma.user.upsert({
    where: { email: superEmail },
    update: { role: 'SUPER_ADMIN', tenantId: tenant.id },
    create: { email: superEmail, role: 'SUPER_ADMIN', tenantId: tenant.id },
  });

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
    await prisma.channel.upsert({
      where: { agentId_kind: { agentId: agent.id, kind } },
      update: { enabled: true },
      create: { agentId: agent.id, kind, enabled: true },
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

  console.log(`Seeded: tenant=${tenant.slug}, super-admin=${superEmail}, agent=${agent.slug} (+chat/phone), 2 referral resources.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
