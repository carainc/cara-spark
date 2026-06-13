import { getDict, getLang } from '@/lib/i18n';

export default async function Home() {
  const t = getDict(await getLang());
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold text-brand">{t.app.name}</h1>
      <p className="mt-3 text-lg text-gray-700">{t.app.tagline}</p>
      <a
        href="/console"
        className="mt-8 inline-block rounded-md bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90"
      >
        {t.console.createAgent}
      </a>
    </section>
  );
}
