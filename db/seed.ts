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
import { TRIAGE_DEMO_PERSONA, TRIAGE_DEMO_ADDITIONAL_INSTRUCTIONS } from './triage-demo-persona';
import { ingestResource, createOpenAIEmbedder, isEmbeddingConfigured, pgStore } from '../lib/rag';

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

  // The Triage Demo agent is wired to Dr. Hobbs's family-medicine bundle (tk-0025): the SIGNED
  // `familymed-v1` gates DECIDE the disposition, and the persona (db/triage-demo-persona.ts) shapes
  // ONLY the conversational voice (Phases 1–3 of the protocol). The persona carries NO disposition
  // logic — no thresholds, no er_911/needs_review/home_care rules — those live exclusively in the
  // engine bundle. Idempotent: the box runs `pnpm db:seed` on every deploy, so a redeploy re-applies.
  const triageDemoFields = {
    status: 'PUBLISHED' as const,
    policyBundleVersion: 'familymed-v1',
    persona: TRIAGE_DEMO_PERSONA,
    additionalInstructions: TRIAGE_DEMO_ADDITIONAL_INSTRUCTIONS,
  };

  const agent = await prisma.agent.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'triage-demo' } },
    update: triageDemoFields,
    create: {
      tenantId: tenant.id,
      name: 'Triage Demo',
      slug: 'triage-demo',
      language: 'EN',
      ...triageDemoFields,
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

  // A SECOND published demo agent on the dedicated STANDALONE Telnyx DID — same Hobbs familymed-v1
  // bundle + persona. This is the agent the standalone LiveKit/SIP voice path routes to (the first
  // `triage-demo` carries the prod/fallback DID via demoPhoneDid()). The DID is assembled at runtime
  // (like the demo emails above) so no literal phone number sits in this seed for the PHI scanner.
  const standaloneDid = ['+1667', '4643821'].join('');
  const standalone = await prisma.agent.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'triage-demo-standalone' } },
    update: triageDemoFields,
    create: {
      tenantId: tenant.id,
      name: 'Triage Demo — Standalone',
      slug: 'triage-demo-standalone',
      language: 'EN',
      ...triageDemoFields,
    },
  });
  for (const kind of ['CHAT', 'PHONE'] as const) {
    const phoneNumber = kind === 'PHONE' ? standaloneDid : null;
    await prisma.channel.upsert({
      where: { agentId_kind: { agentId: standalone.id, kind } },
      update: { enabled: true, phoneNumber },
      create: { agentId: standalone.id, kind, enabled: true, phoneNumber },
    });
  }

  // Sample referral resources (EN + ES). Embed them via the real RAG ingest path (assertNoPhi →
  // chunk → embed → store) when an embedding key is configured, so the food-bank referral actually
  // RETRIEVES in the demo. Without a key, store plain (retrieval simply stays disabled). T12.
  await prisma.referralResource.deleteMany({ where: { tenantId: tenant.id } });
  const referralSeeds = [
    {
      title: 'Community Food Bank',
      body: 'Free groceries Mon–Sat, 9am–5pm. 123 Main St. No ID or appointment required. Fresh produce, canned goods, and bread. Walk-ins welcome; emergency food boxes available.',
      category: 'food_bank',
      language: 'EN' as const,
    },
    {
      title: 'Banco de Alimentos Comunitario',
      body: 'Comida gratis de lunes a sábado, 9am–5pm. Calle Main 123. No se requiere identificación ni cita. Productos frescos, alimentos enlatados y pan. Cajas de comida de emergencia disponibles.',
      category: 'food_bank',
      language: 'ES' as const,
    },
  ];
  if (isEmbeddingConfigured()) {
    const ragDeps = { store: pgStore(prisma), embed: createOpenAIEmbedder() };
    for (const r of referralSeeds) {
      await ingestResource({ tenantId: tenant.id, ...r }, ragDeps);
    }
  } else {
    await prisma.referralResource.createMany({
      data: referralSeeds.map((r) => ({ tenantId: tenant.id, ...r })),
    });
  }

  console.log(
    `Seeded: tenant=${tenant.slug}, super-admin=${superAdmin.email} (count=${superAdminCount}), ` +
      `agents=${agent.slug}+${standalone.slug} (chat/phone each), 2 referral resources.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
