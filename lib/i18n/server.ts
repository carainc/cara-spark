import { cookies } from 'next/headers';
import { isLang, LANG_COOKIE, type Lang } from './index';

/** Server-only: read the active language from the cookie (server components). Defaults to English. */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const v = store.get(LANG_COOKIE)?.value;
  return isLang(v) ? v : 'en';
}
