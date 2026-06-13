/**
 * Lane D / T7 — the internal conversational triage loop. The model PROPOSES typed evidence + a risk
 * estimate; the deterministic engine DECIDES; the canned guidance + provable trace render here.
 *
 * The crisis/not-medical-advice footer renders at the ROOT layout, so it is structurally present on
 * this route (and every route). This page only mounts the model-blind chat.
 */
import { Chat } from './Chat';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function AgentPage() {
  const lang = await getLang();
  const t = getDict(lang).app;
  return (
    <section className="mx-auto max-w-2xl">
      <header className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid h-10 w-10 place-items-center rounded-card text-brand-fg shadow-sm"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 1.5 9.6 6l4.4.3-3.4 2.8 1.1 4.4L8 11.3 4.3 13.5l1.1-4.4L2 6.3 6.4 6 8 1.5Z" fill="currentColor" />
          </svg>
        </span>
        <div>
          <h1 className="font-display text-display-md text-ink-900">{t.name}</h1>
          <p className="text-stamp text-ink-500">{t.tagline}</p>
        </div>
      </header>
      <div className="mt-8 card p-5 sm:p-6">
        <Chat lang={lang} />
      </div>
    </section>
  );
}
