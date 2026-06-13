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
      className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
    >
      {t.switchTo}
    </button>
  );
}
