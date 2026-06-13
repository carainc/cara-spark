import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/lib/auth';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';
import { ConsoleNav } from './ConsoleNav';

/**
 * Console shell (tk-0015). Server-side auth guard (node runtime → Prisma-safe; no edge middleware)
 * plus the elevated console chrome: a persistent section nav + the signed-in identity. The crisis
 * footer + EN/ES toggle still come from the root layout.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const t = getDict(await getLang());
  const role = session.user.role;
  const who = session.user.name ?? session.user.email ?? '';

  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <ConsoleNav labels={t.console.nav} />
        <div className="mt-6 rounded-card border border-ink-line bg-paper-raised p-3.5">
          <p className="overflow-hidden text-ellipsis whitespace-nowrap text-stamp font-medium text-ink-900" title={who}>
            {who}
          </p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-500">
            {role === 'SUPER_ADMIN' ? t.console.superAdmin : role}
          </p>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/' });
            }}
            className="mt-3"
          >
            <button type="submit" className="btn-ghost w-full justify-start px-2 text-stamp">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
