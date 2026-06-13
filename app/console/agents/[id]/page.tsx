import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { bundleVerifiedLabel, demoPhoneDid } from '@/lib/auth/bundle';
import { TOGGLEABLE_CHANNELS } from '@/lib/auth/agents';
import type { ChannelKind } from '@prisma/client';
import { configureChannelsAction, publishAgentAction } from '../actions';

const CHANNEL_LABELS: Record<(typeof TOGGLEABLE_CHANNELS)[number], string> = {
  CHAT: 'Chat',
  VOICE: 'Voice (web)',
  PHONE: 'Phone',
};

/**
 * Configure → publish (T14 / Lane E). Toggle chat/voice/phone, see the read-only phone DID and
 * the verified policy-bundle badge, then publish. Publishing flips Agent.status → PUBLISHED,
 * which is what the engine/voice runtime reads. Scoped to the signed-in user's tenant.
 */
export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const agent = await prisma.agent.findUnique({ where: { id }, include: { channels: true } });
  if (!agent || agent.tenantId !== session.user.tenantId) notFound();

  const enabledByKind = new Map<ChannelKind, boolean>(agent.channels.map((c) => [c.kind, c.enabled]));
  const phoneEnabled = enabledByKind.get('PHONE') === true;

  // Server actions need the agent id bound (closures stay server-side).
  const configure = configureChannelsAction.bind(null, agent.id);
  const publish = publishAgentAction.bind(null, agent.id);

  return (
    <section className="mx-auto max-w-xl">
      <Link href="/console/agents" className="text-sm text-gray-500 hover:underline">
        ← Agents
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{agent.name}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            agent.status === 'PUBLISHED' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {agent.status}
        </span>
      </div>

      <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">
        <span className="font-medium text-gray-700">Policy bundle</span>
        <p className="mt-0.5 text-gray-600">
          {bundleVerifiedLabel(agent.policyBundleVersion)}{' '}
          <span className="text-gray-400">(selector coming in tk-0017)</span>
        </p>
      </div>

      {/* Publish posts the channel checkboxes too, so configure + publish persist together. */}
      <form action={publish} className="mt-6 space-y-4">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-gray-700">Channels</legend>
          {TOGGLEABLE_CHANNELS.map((kind) => (
            <div key={kind} className="rounded-md border border-gray-200 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={`channel_${kind}`}
                  defaultChecked={enabledByKind.get(kind) === true}
                />
                <span className="font-medium">{CHANNEL_LABELS[kind]}</span>
              </label>
              {kind === 'PHONE' && (
                <p className="mt-1 pl-6 text-xs text-gray-500">
                  Number (read-only): <span className="font-mono">{demoPhoneDid()}</span>
                  {phoneEnabled ? '' : ' — shown when enabled'}
                </p>
              )}
            </div>
          ))}
        </fieldset>

        <div className="flex gap-3">
          <button
            type="submit"
            formAction={configure}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Save channels
          </button>
          <button
            type="submit"
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Publish
          </button>
        </div>
      </form>
    </section>
  );
}
