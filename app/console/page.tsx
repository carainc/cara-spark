import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';

export default async function ConsolePage() {
  const session = await auth();
  const t = getDict(await getLang());
  const role = session?.user?.role;
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">
        {t.console.welcome}, {session?.user?.name ?? session?.user?.email}
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        {role === 'SUPER_ADMIN' ? t.console.superAdmin : role}
      </p>
      <p className="mt-6 text-gray-700">
        Cara Spark console — create triage agents, pick channels, and invite teammates.
      </p>
      <Link
        href="/console/agents"
        className="mt-4 inline-block rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
      >
        {t.console.createAgent}
      </Link>

      {/* Lane F (T11/T12) entry points — the call audit trail + referral resources. */}
      <nav className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/console/calls"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          {t.calls.title} →
        </Link>
        <Link
          href="/console/resources"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          {t.resources.title} →
        </Link>
      </nav>
      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/' });
        }}
        className="mt-8"
      >
        <button type="submit" className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50">
          Sign out
        </button>
      </form>
    </section>
  );
}
