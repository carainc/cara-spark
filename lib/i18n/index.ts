import { cookies } from 'next/headers';
import { en, type Dict } from './en';
import { es } from './es';

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

/** Read the active language from the cookie (server components). Defaults to English. */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const v = store.get(LANG_COOKIE)?.value;
  return isLang(v) ? v : 'en';
}

export { en, es };
export type { Dict };
