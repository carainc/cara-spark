/**
 * Referral RESOURCES (T12) — demo beat 3. Upload public community resources (food banks, CHCs) that
 * the agent may CITE in a referral. Advisory + decision-inert: a banner makes clear these never
 * change a clinical disposition. PHI-shaped uploads are rejected (see actions.ts → lib/rag).
 *
 * Server component: lists the tenant's resources; the upload form is a client island. The crisis
 * footer renders at the root layout, so it is present here too.
 */
import { prisma } from '@/lib/db';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';
import { isEmbeddingConfigured } from '@/lib/rag';
import { getActiveTenantId } from '@/lib/audit/tenant';
import { ResourceForm } from './ResourceForm';

export const dynamic = 'force-dynamic';

export default async function ResourcesPage() {
  const t = getDict(await getLang()).resources;
  const tenantId = await getActiveTenantId();

  const resources = tenantId
    ? await prisma.referralResource.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        // never select the embedding column (pgvector Unsupported) — display fields only.
        select: { id: true, title: true, body: true, category: true, language: true, createdAt: true },
      })
    : [];

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <p className="mt-1 text-sm text-gray-600">{t.subtitle}</p>
      <p className="mt-2 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
        {t.decisionInert}
      </p>

      <div className="mt-6">
        <ResourceForm t={t} keyConfigured={isEmbeddingConfigured()} />
      </div>

      {resources.length === 0 ? (
        <p className="mt-8 rounded-md border border-dashed border-gray-300 p-6 text-center text-gray-500">
          {t.empty}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {resources.map((r) => (
            <li key={r.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold">{r.title}</h3>
                <span className="text-xs text-gray-400">{r.language}</span>
              </div>
              {r.category && (
                <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {t.category}: {r.category}
                </span>
              )}
              <p className="mt-2 text-sm text-gray-700">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
