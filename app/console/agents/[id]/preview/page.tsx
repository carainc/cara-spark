/**
 * Lane D / T15 — PREVIEW-before-publish. A creator views their agent's branded page (theme + chat +
 * the mandatory footer) before flipping it live. Unlike the public `/a/...` page, preview works for a
 * DRAFT agent and is auth-guarded + tenant-scoped. Same sanitized theme, same model-blind chat.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { resolveBrandingByAgentId, themeStyle } from '@/lib/branding';
import { prisma } from '@/lib/db';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';
import { Chat } from '@/app/agent/Chat';

export const dynamic = 'force-dynamic';

export default async function AgentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const tenantId = session.user.tenantId;
  if (!tenantId) notFound();

  const lang = await getLang();
  const t = getDict(lang);

  const resolved = await resolveBrandingByAgentId(prisma, id, tenantId);
  if (!resolved) notFound();

  return (
    <section className="mx-auto max-w-2xl">
      <Link href={`/console/agents/${id}`} className="text-sm text-gray-500 hover:underline">
        ← {resolved.agentName}
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          Preview {resolved.published ? '' : '· DRAFT'}
        </span>
      </div>

      <div
        data-testid="preview-page"
        data-agent-id={id}
        className="mt-4 rounded-lg border border-gray-200 p-5"
        style={themeStyle(resolved.theme)}
      >
        <header className="flex items-center gap-3">
          {resolved.theme.brandLogoUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              data-testid="brand-logo"
              src={resolved.theme.brandLogoUrl}
              alt={resolved.theme.displayName ?? resolved.agentName}
              className="h-10 w-auto rounded"
            />
          )}
          <h1 className="text-xl font-bold" style={{ color: 'var(--brand)' }} data-testid="brand-name">
            {resolved.theme.displayName ?? resolved.agentName}
          </h1>
        </header>
        <div className="mt-5">
          <Chat lang={lang} />
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">{t.agent.intro}</p>
    </section>
  );
}
