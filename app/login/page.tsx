import { signIn } from '@/lib/auth';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';

/**
 * Console sign-in (tk-0015 elevation). BOTH paths are preserved: Google OAuth and the email +
 * credentials fallback (self-host friendly), each with its original server action and i18n copy.
 * The credential field names ('email' / the secret field) and the credentials provider call are
 * unchanged — only the surrounding presentation is elevated.
 */
export default async function LoginPage() {
  const t = getDict(await getLang());
  return (
    <section className="mx-auto max-w-md">
      <div className="card bg-paper-raised p-7 sm:p-8">
        <span
          aria-hidden
          className="grid h-11 w-11 place-items-center rounded-card text-brand-fg shadow-sm"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 1.5 9.6 6l4.4.3-3.4 2.8 1.1 4.4L8 11.3 4.3 13.5l1.1-4.4L2 6.3 6.4 6 8 1.5Z" fill="currentColor" />
          </svg>
        </span>
        <h1 className="mt-4 font-display text-display-md text-ink-900">{t.login.title}</h1>
        <p className="mt-2 text-ink-700">{t.login.note}</p>

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/console' });
          }}
          className="mt-6"
        >
          <button type="submit" className="btn-secondary w-full">
            <svg aria-hidden width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
            </svg>
            {t.login.google}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-stamp uppercase tracking-wide text-ink-300">
          <span className="h-px flex-1 bg-ink-line" />
          {t.login.or}
          <span className="h-px flex-1 bg-ink-line" />
        </div>

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
          className="space-y-4"
        >
          <label className="block">
            <span className="field-label">{t.login.email}</span>
            <input
              name="email"
              type="email"
              required
              placeholder={t.login.email}
              autoComplete="username"
              className="field"
            />
          </label>
          <label className="block">
            <span className="field-label">{t.login.passwordLabel}</span>
            <input
              name="password"
              type="password"
              required
              placeholder={t.login.passwordLabel}
              autoComplete="current-password"
              className="field"
            />
          </label>
          <button type="submit" className="btn-primary w-full">
            {t.login.passwordSignIn}
          </button>
        </form>
      </div>
    </section>
  );
}
