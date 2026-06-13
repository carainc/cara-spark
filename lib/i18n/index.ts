import { en, type Dict } from './en';
import { es } from './es';

// Client-safe: no next/headers here, so 'use client' components (LanguageToggle) can import getDict.
// The server-only cookie reader lives in ./server.

export type Lang = 'en' | 'es';
export const LANGS: Lang[] = ['en', 'es'];
export const LANG_COOKIE = 'cara_lang';

const DICTS: Record<Lang, Dict> = { en, es };

export function getDict(lang: Lang): Dict {
  return DICTS[lang] ?? en;
}

export function isLang(v: string | undefined): v is Lang {
  return v === 'en' || v === 'es';
}

export { en, es };
export type { Dict };
