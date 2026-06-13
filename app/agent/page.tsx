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
      <h1 className="text-2xl font-bold text-gray-900">{t.name}</h1>
      <p className="mt-1 text-sm text-gray-500">{t.tagline}</p>
      <div className="mt-6">
        <Chat lang={lang} />
      </div>
    </section>
  );
}
