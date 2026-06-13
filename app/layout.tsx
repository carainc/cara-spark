import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Newsreader, Public_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';
import { SafetyFooter } from '@/components/SafetyFooter';
import { LanguageToggle } from '@/components/LanguageToggle';

/**
 * Fonts are self-hosted at build by next/font (no runtime CDN call), so an air-gapped CHC deploy
 * still gets the full type system. "Clinical Ledger" pairing (tk-0015):
 *   - Newsreader  — humanist serif for headings + the disclaimer voice (clinical-but-human).
 *   - Public Sans — USWDS's high-legibility grotesque, built for government/accessibility.
 *   - IBM Plex Mono — the verification "stamp" face for checksums / signatures.
 */
const display = Newsreader({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-display' });
const sans = Public_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Cara Spark — Failsafe Triage Agent Creator',
  description: 'Open-source, BYO-key, self-hostable failsafe medical-triage agent creator.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  const t = getDict(lang);
  return (
    <html lang={lang} className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      {/* min-h-screen flex column + SafetyFooter mt-auto => footer is on EVERY page, structurally. */}
      <body className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 border-b border-ink-line bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
            <Link href="/" className="group flex items-center gap-2.5" aria-label={t.app.name}>
              {/* Tamper-evident "spark" mark — a verification seal, not a generic AI orb. */}
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded-stamp text-brand-fg shadow-sm"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M8 1.5 9.6 6l4.4.3-3.4 2.8 1.1 4.4L8 11.3 4.3 13.5l1.1-4.4L2 6.3 6.4 6 8 1.5Z" fill="currentColor" />
                </svg>
              </span>
              <span className="font-display text-lg font-semibold text-ink-900 group-hover:text-brand-700">
                {t.app.name}
              </span>
            </Link>
            <LanguageToggle lang={lang} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">{children}</main>
        <SafetyFooter lang={lang} />
      </body>
    </html>
  );
}
