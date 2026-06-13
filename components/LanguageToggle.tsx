'use client';

import { useTransition } from 'react';
import { getDict, type Lang } from '@/lib/i18n';

/** EN/ES toggle — writes the lang cookie and refreshes. Everything (incl. footer) re-renders. */
export function LanguageToggle({ lang }: { lang: Lang }) {
  const [pending, start] = useTransition();
  const next: Lang = lang === 'en' ? 'es' : 'en';
  const t = getDict(lang).toggle;

  return (
    <button
      type="button"
      aria-label={t.label}
      disabled={pending}
      onClick={() =>
        start(() => {
          document.cookie = `cara_lang=${next}; path=/; max-age=31536000`;
          window.location.reload();
        })
      }
      className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-stamp border-2 border-ink-line bg-paper-raised px-3 text-stamp font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
    >
      <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM2.6 8.5h2.2c.1 1.3.4 2.5.8 3.5A5.5 5.5 0 0 1 2.6 8.5Zm2.2-1H2.6a5.5 5.5 0 0 1 3-3.5c-.4 1-.7 2.2-.8 3.5ZM8 2.7c.6.7 1.2 2 1.4 4H6.6c.2-2 .8-3.3 1.4-4Zm0 10.6c-.6-.7-1.2-2-1.4-4h2.8c-.2 2-.8 3.3-1.4 4Zm2.4-1.6c.4-1 .7-2.2.8-3.5h2.2a5.5 5.5 0 0 1-3 3.5Zm.8-4.5c-.1-1.3-.4-2.5-.8-3.5a5.5 5.5 0 0 1 3 3.5h-2.2Z"
          fill="currentColor"
        />
      </svg>
      {t.switchTo}
    </button>
  );
}
