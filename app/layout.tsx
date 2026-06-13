import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { getDict, getLang } from '@/lib/i18n';
import { SafetyFooter } from '@/components/SafetyFooter';
import { LanguageToggle } from '@/components/LanguageToggle';

export const metadata: Metadata = {
  title: 'Cara Spark — Failsafe Triage Agent Creator',
  description: 'Open-source, BYO-key, self-hostable failsafe medical-triage agent creator.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  const t = getDict(lang);
  return (
    <html lang={lang}>
      {/* min-h-screen flex column + SafetyFooter mt-auto => footer is on EVERY page, structurally. */}
      <body className="flex min-h-screen flex-col bg-white text-gray-900 antialiased">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <a href="/" className="font-semibold text-brand">
            {t.app.name}
          </a>
          <LanguageToggle lang={lang} />
        </header>
        <main className="flex-1 px-4 py-6">{children}</main>
        <SafetyFooter lang={lang} />
      </body>
    </html>
  );
}
