import Link from 'next/link';
import { auth } from '@/lib/auth';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';

/**
 * Console home (tk-0015). Sign-out + section nav live in the console shell now, so this page is the
 * welcome + primary call to action. Entry points to Agents / Resources / Audit are in the shell nav.
 */
export default async function ConsolePage() {
  const session = await auth();
  const t = getDict(await getLang());
  return (
    <section>
      <h1 className="font-display text-display-md text-ink-900">
        {t.console.welcome}, {session?.user?.name ?? session?.user?.email}
      </h1>
      <p className="mt-2 max-w-prose text-body-lg text-ink-700">{t.console.shellSubtitle}</p>
      <div className="mt-6">
        <Link href="/console/agents" className="btn-primary">
          {t.console.createAgent}
        </Link>
      </div>
    </section>
  );
}
