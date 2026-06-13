import Link from 'next/link';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';

/**
 * Public landing (tk-0015, "Clinical Ledger"). The hero states the thesis — the model proposes,
 * the engine decides, provably — and a miniature trace card makes that legible at a glance. All
 * copy is bilingual via lib/i18n; the crisis footer renders at the root layout.
 */
export default async function Home() {
  const t = getDict(await getLang());
  const l = t.landing;

  const pillars = [
    { title: l.pillar1Title, body: l.pillar1Body },
    { title: l.pillar2Title, body: l.pillar2Body },
    { title: l.pillar3Title, body: l.pillar3Body },
  ];

  return (
    <div className="-mt-2">
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
        <div>
          <p className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-stamp font-semibold uppercase tracking-wide text-brand-800">
            {l.eyebrow}
          </p>
          <h1 className="mt-5 text-balance font-display text-display-lg text-ink-900 sm:text-display-xl">
            {l.headline}{' '}
            <span className="text-brand-700">{l.headlineAccent}</span>
          </h1>
          <p className="mt-5 max-w-prose text-balance text-body-lg text-ink-700">{l.subhead}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/console" className="btn-primary">
              {l.primaryCta}
            </Link>
            <Link href="/agent" className="btn-secondary">
              {l.secondaryCta}
            </Link>
          </div>
        </div>

        {/* Miniature provable-trace — the product's signature visual, as the hero centerpiece. */}
        <figure
          aria-label={l.traceDemoLabel}
          className="card overflow-hidden bg-paper-raised bg-ledger-rule p-0"
        >
          <figcaption className="flex items-center justify-between border-b border-ink-line bg-paper-sunken px-5 py-3">
            <span className="text-stamp font-semibold uppercase tracking-wide text-ink-500">
              {l.traceDemoLabel}
            </span>
            <span className="ledger-stamp-ok animate-stamp-in" style={{ animationDelay: '0.5s' }}>
              <CheckIcon /> v1.0.0 · {l.traceDemoEngine}
            </span>
          </figcaption>
          <div className="space-y-3 p-5">
            <div className="animate-rise-in rounded-stamp border border-ink-line bg-paper p-3" style={{ animationDelay: '0.05s' }}>
              <p className="text-stamp font-semibold uppercase tracking-wide text-ink-500">{l.traceDemoModel}</p>
              <p className="mt-1 font-mono text-stamp text-ink-700">{l.traceDemoEvidence}</p>
            </div>
            <div aria-hidden className="flex justify-center text-brand-400">
              <ArrowDown />
            </div>
            <div className="animate-rise-in rounded-stamp border-l-4 border-crisis bg-crisis/5 p-3" style={{ animationDelay: '0.2s' }}>
              <p className="text-stamp font-semibold uppercase tracking-wide text-crisis">{l.traceDemoEngine}</p>
              <p className="mt-1 font-display text-lg font-semibold text-ink-900">ED_OR_911_GUIDANCE</p>
              <p className="mt-1 flex items-center gap-1.5 text-stamp font-medium text-crisis">
                <LockIcon /> {l.traceDemoLocked}
              </p>
            </div>
          </div>
        </figure>
      </section>

      <section className="mt-16 sm:mt-20">
        <h2 className="font-display text-display-md text-ink-900">{l.pillarsTitle}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {pillars.map((p, i) => (
            <div key={i} className="card p-5">
              <span aria-hidden className="grid h-9 w-9 place-items-center rounded-stamp bg-brand-50 font-mono text-stamp font-semibold text-brand-700">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-3 font-display text-xl font-semibold text-ink-900">{p.title}</h3>
              <p className="mt-1.5 text-ink-700">{p.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="m13 4-7 7-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function ArrowDown() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M8 3v9m0 0 3.5-3.5M8 12 4.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
