/**
 * Call audit-trail LIST (T11). Shows recorded calls scoped to the signed-in user's tenant, each
 * with its disposition + an engine-intervention count. Links into the per-call trail (demo beat
 * 2-replay). Server component — reads Prisma directly (node runtime via the console layout guard).
 */
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';
import { getActiveTenantId } from '@/lib/audit/tenant';

export const dynamic = 'force-dynamic';

async function getCalls(tenantId: string | null) {
  // Single-tenant law: scope to the user's tenant (calls belong to that tenant's agents).
  return prisma.call.findMany({
    where: tenantId ? { agent: { tenantId } } : undefined,
    orderBy: { startedAt: 'desc' },
    take: 100,
    include: {
      agent: { select: { name: true } },
      auditEntries: { select: { intervention: true } },
    },
  });
}

export default async function CallsPage() {
  const t = getDict(await getLang()).calls;
  const tenantId = await getActiveTenantId();
  const calls = await getCalls(tenantId);

  return (
    <section className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <p className="mt-1 text-sm text-gray-600">{t.subtitle}</p>

      {calls.length === 0 ? (
        <p className="mt-8 rounded-md border border-dashed border-gray-300 p-6 text-center text-gray-500">
          {t.empty}
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">{t.started}</th>
              <th className="py-2 pr-4 font-medium">{t.channel}</th>
              <th className="py-2 pr-4 font-medium">{t.disposition}</th>
              <th className="py-2 pr-4 font-medium">{t.interventions}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => {
              const interventions = c.auditEntries.filter((a) => a.intervention).length;
              return (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4 tabular-nums text-gray-700">
                    {new Date(c.startedAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">{c.channel}</td>
                  <td className="py-2 pr-4">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{c.disposition ?? '—'}</code>
                  </td>
                  <td className="py-2 pr-4">
                    {interventions > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-crisis/10 px-2 py-0.5 text-xs font-semibold text-crisis">
                        {interventions}
                      </span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <Link href={`/console/calls/${c.id}`} className="font-medium text-brand hover:underline">
                      {t.viewTrail} →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
