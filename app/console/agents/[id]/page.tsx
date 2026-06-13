import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';
import { demoPhoneDid, listPolicyBundles } from '@/lib/auth/bundle';
import { TOGGLEABLE_CHANNELS, agentPublicUrl } from '@/lib/auth/agents';
import { isEmbeddingConfigured } from '@/lib/rag';
import { getActiveTenantId } from '@/lib/audit/tenant';
import type { ChannelKind } from '@prisma/client';
import {
  configureChannelsAction,
  publishAgentAction,
  setPolicyBundleAction,
  updateAgentCustomizationAction,
} from '../actions';
import { ResourceForm } from '../../resources/ResourceForm';
import { AgentTabs } from './AgentTabs';
import { PolicyBundleForm } from './PolicyBundleForm';

/**
 * Tabbed agent configuration (tk-0022; absorbs tk-0017). One screen per concern, surfacing the
 * EXISTING backends only — channels (Lane E), the signed policy bundle (engine), the referral
 * corpus (Lane F), and the branded preview (Lane D). Nothing here adjudicates: it writes config
 * rows the deterministic engine + voice runtime read.
 *
 * Each tab panel is server-rendered and handed to a client tab shell, so every form stays a server
 * action and there is no client data fetching. Scoped to the signed-in user's tenant.
 */
export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { channels: true, tenant: { select: { slug: true } } },
  });
  if (!agent || agent.tenantId !== session.user.tenantId) notFound();

  const lang = await getLang();
  const t = getDict(lang);
  const c = t.agentConfig;

  const enabledByKind = new Map<ChannelKind, boolean>(agent.channels.map((ch) => [ch.kind, ch.enabled]));
  const phoneEnabled = enabledByKind.get('PHONE') === true;
  const bundles = listPolicyBundles();

  // Referral corpus is tenant-scoped (the model the agent draws from); list it for this tab.
  const tenantId = await getActiveTenantId();
  const resources =
    tenantId === agent.tenantId
      ? await prisma.referralResource.findMany({
          where: { tenantId: agent.tenantId },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: { id: true, title: true, body: true, category: true, language: true, createdAt: true },
        })
      : [];

  // Bind agent id into the server actions (closures stay server-side).
  const configure = configureChannelsAction.bind(null, agent.id);
  const publish = publishAgentAction.bind(null, agent.id);
  const setBundle = setPolicyBundleAction.bind(null, agent.id);
  const saveCustomization = updateAgentCustomizationAction.bind(null, agent.id);

  // PUBLIC link to the branded page (only meaningful once PUBLISHED). Base is the deploy's public
  // origin — AUTH_URL (mirrored to NEXTAUTH_URL), defaulting to localhost for self-host/dev. The
  // route is /a/{tenant}/{agentSlug} (app/a/[tenant]/[agentSlug]).
  const publicBase = process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const publicUrl = agentPublicUrl(publicBase, agent.tenant.slug, agent.slug);
  const isPublished = agent.status === 'PUBLISHED';

  const statusLabel =
    agent.status === 'PUBLISHED' ? c.statusPublished : agent.status === 'ARCHIVED' ? c.statusArchived : c.statusDraft;

  const tabs = [
    { id: 'general', label: c.tabs.general },
    { id: 'channels', label: c.tabs.channels },
    { id: 'policies', label: c.tabs.policies },
    { id: 'corpus', label: c.tabs.corpus },
    { id: 'preview', label: c.tabs.preview },
  ];

  const panels = {
    /* ---------- GENERAL ---------- */
    general: (
      <div className="card max-w-2xl p-5">
        <h2 className="font-display text-xl font-semibold text-ink-900">{c.general.title}</h2>
        <p className="mt-1 text-ink-700">{c.general.subtitle}</p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label={c.general.nameLabel}>{agent.name}</Field>
          <Field label={c.general.slugLabel}>
            <code className="font-mono text-stamp text-ink-700">/{agent.slug}</code>
          </Field>
          <Field label={c.general.languageLabel}>{agent.language}</Field>
          <Field label={c.tabs.policies}>
            <code className="font-mono text-stamp text-ink-700">{agent.policyBundleVersion}</code>
          </Field>
        </dl>

        {/* PUBLIC link — shown only once PUBLISHED. Clickable + copyable as plain selectable text. */}
        <div className="mt-5" data-testid="agent-public-link">
          <span className="field-label">{c.general.publicLinkLabel}</span>
          {isPublished ? (
            <>
              <p className="mt-1 text-stamp text-ink-500">{c.general.publicLinkHelp}</p>
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="agent-public-url"
                className="mt-1.5 block break-all rounded-card border border-ink-line bg-paper-sunken px-3 py-2 font-mono text-stamp text-brand-700 hover:underline"
              >
                {publicUrl}
              </a>
            </>
          ) : (
            <p className="mt-1 text-stamp text-ink-300">{c.general.publicLinkDraftNote}</p>
          )}
        </div>

        {/* Agent customization (tk-0015) — TONE/STYLE only. The honest helper text is kept: these
            tune tone, the engine still owns every disposition. Saved via a server action. */}
        <form action={saveCustomization} className="mt-6 space-y-4">
          <label className="block">
            <span className="field-label">{c.general.personaLabel}</span>
            <textarea
              name="persona"
              rows={2}
              defaultValue={agent.persona ?? ''}
              placeholder={c.general.personaPlaceholder}
              className="field"
            />
            <span className="mt-1.5 block text-stamp text-ink-500">{c.general.personaHelp}</span>
          </label>

          <label className="block">
            <span className="field-label">{c.general.systemPromptExtraLabel}</span>
            <textarea
              name="systemPromptExtra"
              rows={3}
              defaultValue={agent.systemPromptExtra ?? ''}
              placeholder={c.general.systemPromptExtraPlaceholder}
              className="field"
            />
            <span className="mt-1.5 block text-stamp text-ink-500">{c.general.systemPromptExtraHelp}</span>
          </label>

          <label className="block">
            <span className="field-label">{c.general.additionalInstructionsLabel}</span>
            <textarea
              name="additionalInstructions"
              rows={3}
              defaultValue={agent.additionalInstructions ?? ''}
              placeholder={c.general.additionalInstructionsPlaceholder}
              className="field"
            />
            <span className="mt-1.5 block text-stamp text-ink-500">{c.general.additionalInstructionsHelp}</span>
          </label>

          <p className="rounded-card bg-amber-50 px-3 py-2 text-stamp font-medium text-amber-800">
            {c.general.customizationNote}
          </p>
          <button type="submit" className="btn-primary" data-testid="save-customization">
            {c.general.save}
          </button>
        </form>

        <p className="mt-3 text-stamp text-ink-300">{c.general.readonlyNote}</p>
      </div>
    ),

    /* ---------- CHANNELS (Lane E) ---------- */
    channels: (
      <div className="card max-w-2xl p-5">
        <h2 className="font-display text-xl font-semibold text-ink-900">{c.channels.title}</h2>
        <p className="mt-1 text-ink-700">{c.channels.subtitle}</p>
        {/* Publish posts the channel checkboxes too, so configure + publish persist together. */}
        <form action={publish} className="mt-5 space-y-4">
          <fieldset className="space-y-3">
            <legend className="sr-only">{c.channels.title}</legend>
            {TOGGLEABLE_CHANNELS.map((kind) => (
              <div key={kind} className="rounded-card border border-ink-line bg-paper p-4">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    name={`channel_${kind}`}
                    defaultChecked={enabledByKind.get(kind) === true}
                    className="h-5 w-5 rounded border-ink-line text-brand-600 focus:ring-brand-500"
                  />
                  <span className="font-medium text-ink-900">
                    {kind === 'CHAT' ? c.channels.chat : kind === 'VOICE' ? c.channels.voice : c.channels.phone}
                  </span>
                </label>
                {kind === 'PHONE' && (
                  <p className="mt-2 pl-7 text-stamp text-ink-500">
                    {c.channels.didLabel}: <span className="font-mono text-ink-700">{demoPhoneDid()}</span>
                    {phoneEnabled ? '' : ` — ${c.channels.didWhenEnabled}`}
                  </p>
                )}
              </div>
            ))}
          </fieldset>
          <p className="text-stamp text-ink-500">{c.channels.didNote}</p>
          <div className="flex gap-3">
            <button type="submit" formAction={configure} className="btn-secondary">
              {c.saveChannels}
            </button>
            <button type="submit" className="btn-primary">
              {c.publish}
            </button>
          </div>
        </form>
      </div>
    ),

    /* ---------- POLICIES / BUNDLES (engine; tk-0017) ---------- */
    policies: (
      <div className="max-w-2xl">
        <h2 className="font-display text-xl font-semibold text-ink-900">{c.policies.title}</h2>
        <p className="mt-1 text-ink-700">{c.policies.subtitle}</p>
        <div className="mt-5">
          <PolicyBundleForm
            bundles={bundles}
            currentVersion={agent.policyBundleVersion}
            action={setBundle}
            t={c.policies}
          />
        </div>
      </div>
    ),

    /* ---------- CORPUS / RAG (Lane F) ---------- */
    corpus: (
      <div className="max-w-2xl">
        <h2 className="font-display text-xl font-semibold text-ink-900">{c.corpus.title}</h2>
        <p className="mt-1 text-ink-700">{c.corpus.subtitle}</p>
        <p className="mt-3 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-stamp font-medium text-amber-800">
          {t.resources.decisionInert}
        </p>
        <div className="mt-5">
          <ResourceForm t={t.resources} keyConfigured={isEmbeddingConfigured()} />
        </div>
        {resources.length === 0 ? (
          <p className="mt-6 rounded-card border border-dashed border-ink-line p-6 text-center text-ink-500">
            {t.resources.empty}
          </p>
        ) : (
          <ul className="mt-6 space-y-2.5">
            {resources.map((r) => (
              <li key={r.id} className="card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium text-ink-900">{r.title}</h3>
                  <span className="text-stamp text-ink-300">{r.language}</span>
                </div>
                {r.category && (
                  <span className="mt-1 inline-block rounded bg-paper-sunken px-1.5 py-0.5 text-stamp text-ink-700">
                    {t.resources.category}: {r.category}
                  </span>
                )}
                <p className="mt-2 text-stamp text-ink-700">{r.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    ),

    /* ---------- PREVIEW (Lane D) ---------- */
    preview: (
      <div className="card max-w-2xl p-5">
        <h2 className="font-display text-xl font-semibold text-ink-900">{c.preview.title}</h2>
        <p className="mt-1 text-ink-700">{c.preview.subtitle}</p>
        <Link href={`/console/agents/${agent.id}/preview`} className="btn-primary mt-5" data-testid="open-preview">
          {c.preview.open}
        </Link>
        <p className="mt-3 text-stamp text-ink-500">{c.preview.draftNote}</p>
      </div>
    ),
  };

  return (
    <section>
      <Link href="/console/agents" className="text-stamp text-ink-500 hover:text-ink-900 hover:underline">
        ← {c.back}
      </Link>
      <div className="mt-2 flex items-center justify-between gap-4">
        <h1 className="font-display text-display-md text-ink-900">{agent.name}</h1>
        <span
          data-testid="agent-status"
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-stamp font-semibold ${
            agent.status === 'PUBLISHED' ? 'bg-verified-soft text-verified-ink' : 'bg-paper-sunken text-ink-700'
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <AgentTabs tabs={tabs} panels={panels} />
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="field-label">{label}</dt>
      <dd className="text-body text-ink-900">{children}</dd>
    </div>
  );
}
