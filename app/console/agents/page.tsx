import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canInvite } from '@/lib/auth/roles';
import { InviteForm } from './invite-form';

// Always render live agent data in the admin console (matches the [id] detail page).
export const dynamic = 'force-dynamic';

/**
 * Agents list — the creator's home (T14 / Lane E). Lists the tenant's agents with status +
 * enabled channels, links to create/configure, and (for admins+) the invite-a-teammate form.
 */
export default async function AgentsPage() {
  const session = await auth();
  const role = session?.user?.role;
  const tenantId = session?.user?.tenantId ?? undefined;

  const agents = tenantId
    ? await prisma.agent.findMany({
        where: { tenantId },
        include: { channels: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-display-md text-ink-900">Triage agents</h1>
        <Link href="/console/agents/new" className="btn-primary">
          Create a triage agent
        </Link>
      </div>

      {!tenantId && (
        <p className="mt-6 rounded-card border-l-4 border-amber-400 bg-amber-50 p-3 text-amber-800">
          Your account is not attached to a tenant yet. Ask an admin to invite you.
        </p>
      )}

      <ul className="mt-6 space-y-2.5">
        {agents.length === 0 && (
          <li className="card p-8 text-center text-ink-500">No agents yet — create your first triage agent.</li>
        )}
        {agents.map((agent) => {
          const enabled = agent.channels.filter((c) => c.enabled).map((c) => c.kind);
          const published = agent.status === 'PUBLISHED';
          return (
            <li key={agent.id} className="card flex items-center justify-between gap-4 p-4 transition-shadow hover:shadow-raised">
              <div className="min-w-0">
                <Link href={`/console/agents/${agent.id}`} className="font-display text-lg font-semibold text-ink-900 hover:text-brand-700">
                  {agent.name}
                </Link>
                <p className="mt-0.5 text-stamp text-ink-500">
                  channels: {enabled.length ? enabled.join(', ') : 'none'}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-stamp font-semibold ${
                  published ? 'bg-verified-soft text-verified-ink' : 'bg-paper-sunken text-ink-700'
                }`}
              >
                {agent.status}
              </span>
            </li>
          );
        })}
      </ul>

      {canInvite(role) && tenantId && (
        <div className="card mt-10 p-5">
          <h2 className="font-display text-xl font-semibold text-ink-900">Invite a teammate</h2>
          <p className="mt-1 text-ink-700">
            They sign in with Google through the invite link and join this tenant with the role you pick.
          </p>
          <InviteForm actorRole={role} />
        </div>
      )}
    </section>
  );
}
