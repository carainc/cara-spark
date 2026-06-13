import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canInvite } from '@/lib/auth/roles';
import { InviteForm } from './invite-form';

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
    <section className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Triage agents</h1>
        <Link
          href="/console/agents/new"
          className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          Create a triage agent
        </Link>
      </div>

      {!tenantId && (
        <p className="mt-6 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Your account is not attached to a tenant yet. Ask an admin to invite you.
        </p>
      )}

      <ul className="mt-6 divide-y divide-gray-200 rounded-md border border-gray-200">
        {agents.length === 0 && (
          <li className="p-4 text-sm text-gray-500">No agents yet — create your first triage agent.</li>
        )}
        {agents.map((agent) => {
          const enabled = agent.channels.filter((c) => c.enabled).map((c) => c.kind);
          return (
            <li key={agent.id} className="flex items-center justify-between p-4">
              <div>
                <Link href={`/console/agents/${agent.id}`} className="font-medium hover:underline">
                  {agent.name}
                </Link>
                <p className="mt-0.5 text-xs text-gray-500">
                  {agent.status} · channels: {enabled.length ? enabled.join(', ') : 'none'}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  agent.status === 'PUBLISHED' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {agent.status}
              </span>
            </li>
          );
        })}
      </ul>

      {canInvite(role) && tenantId && (
        <div className="mt-10 rounded-md border border-gray-200 p-4">
          <h2 className="text-lg font-semibold">Invite a teammate</h2>
          <p className="mt-1 text-sm text-gray-600">
            They sign in with Google through the invite link and join this tenant with the role you pick.
          </p>
          <InviteForm actorRole={role} />
        </div>
      )}
    </section>
  );
}
