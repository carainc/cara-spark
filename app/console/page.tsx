import { auth, signOut } from '@/lib/auth';
import { getDict, getLang } from '@/lib/i18n';

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
        Cara Spark console — agent creation, channels, and invites land here (Lane E / T14).
      </p>
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
