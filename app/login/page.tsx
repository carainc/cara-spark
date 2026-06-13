import { signIn } from '@/lib/auth';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';

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

      <div className="my-4 text-center text-xs uppercase tracking-wide text-gray-400">{t.login.or}</div>

      {/* Credentials login (no-Google fallback + self-host friendly). Seeded super-admin/admins have a
          bcrypt passwordHash; invalid creds redirect back to /login?error=CredentialsSignin. */}
      <form
        action={async (formData: FormData) => {
          'use server';
          await signIn('credentials', {
            email: formData.get('email'),
            password: formData.get('password'),
            redirectTo: '/console',
          });
        }}
        className="space-y-3"
      >
        <input
          name="email"
          type="email"
          required
          placeholder={t.login.email}
          autoComplete="username"
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder={t.login.passwordLabel}
          autoComplete="current-password"
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90"
        >
          {t.login.passwordSignIn}
        </button>
      </form>
    </section>
  );
}
