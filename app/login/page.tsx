import { signIn } from '@/lib/auth';
import { getDict, getLang } from '@/lib/i18n';

export default async function LoginPage() {
  const t = getDict(await getLang());
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">{t.login.title}</h1>
      <p className="mt-2 text-sm text-gray-600">{t.login.note}</p>
      <form
        action={async () => {
          'use server';
          await signIn('google', { redirectTo: '/console' });
        }}
        className="mt-6"
      >
        <button
          type="submit"
          className="w-full rounded-md border border-gray-300 px-4 py-2 font-medium hover:bg-gray-50"
        >
          {t.login.google}
        </button>
      </form>
    </section>
  );
}
