/**
 * Lane D / T15 — the BRANDED public standalone page. A patient reaches a CHC's triage agent at
 * `/a/{tenant}/{agentSlug}`: themed (logo + brand color), bilingual (EN/ES toggle in the layout
 * header), channel-aware (only renders chat when the CHAT channel is enabled and the agent is
 * PUBLISHED), with the mandatory crisis/not-medical-advice footer (layout level — never removable).
 *
 * The theme comes through `sanitizeBranding`, so a malicious brand payload cannot inject script or
 * touch the footer (see lib/branding/sanitize + tests/branding.test.ts).
 */
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';
import { sanitizeBranding, themeStyle } from '@/lib/branding';
import { Chat } from '@/app/agent/Chat';

export const dynamic = 'force-dynamic';

export default async function BrandedAgentPage({
  params,
}: {
  params: Promise<{ tenant: string; agentSlug: string }>;
}) {
  const { tenant: tenantSlug, agentSlug } = await params;
  const lang = await getLang();
  const t = getDict(lang);

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true, brandLogoUrl: true, brandColor: true },
  });
  if (!tenant) notFound();

  const agent = await prisma.agent.findFirst({
    where: { tenantId: tenant.id, slug: agentSlug },
    select: {
      id: true,
      name: true,
      status: true,
      brandLogoUrl: true,
      brandColor: true,
      channels: { select: { kind: true, enabled: true } },
    },
  });
  // Public page is live only when PUBLISHED. DRAFT/ARCHIVED → 404 (preview is in the console).
  if (!agent || agent.status !== 'PUBLISHED') notFound();

  const chatEnabled = agent.channels.some((c) => c.kind === 'CHAT' && c.enabled);

  const theme = sanitizeBranding({
    brandColor: agent.brandColor ?? tenant.brandColor,
    brandLogoUrl: agent.brandLogoUrl ?? tenant.brandLogoUrl,
    displayName: agent.name,
  });

  return (
    <section
      data-testid="branded-page"
      data-tenant={tenantSlug}
      data-agent={agentSlug}
      className="mx-auto max-w-2xl"
      style={themeStyle(theme)}
    >
      <header className="flex items-center gap-3">
        {theme.brandLogoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            data-testid="brand-logo"
            src={theme.brandLogoUrl}
            alt={theme.displayName ?? tenant.name}
            className="h-10 w-auto rounded"
          />
        )}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--brand)' }} data-testid="brand-name">
            {theme.displayName ?? agent.name}
          </h1>
          <p className="text-xs text-gray-500">{tenant.name}</p>
        </div>
      </header>

      <div className="mt-6">
        {chatEnabled ? (
          <Chat agentId={agent.id} lang={lang} />
        ) : (
          <p data-testid="chat-disabled" className="rounded-md bg-gray-50 p-4 text-sm text-gray-600">
            {t.agent.intro}
          </p>
        )}
      </div>
    </section>
  );
}
