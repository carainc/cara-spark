'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Console section nav (tk-0015). Client component only so it can highlight the active section via
 * usePathname — no data, no PHI. Labels are passed in from the server (already localized).
 */
export function ConsoleNav({ labels }: { labels: { agents: string; resources: string; calls: string } }) {
  const pathname = usePathname();
  const items = [
    { href: '/console/agents', label: labels.agents, icon: <AgentsIcon /> },
    { href: '/console/resources', label: labels.resources, icon: <CorpusIcon /> },
    { href: '/console/calls', label: labels.calls, icon: <AuditIcon /> },
  ];

  return (
    <nav aria-label="Console" className="flex gap-1.5 lg:flex-col">
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-[2.5rem] items-center gap-2.5 rounded-stamp px-3 text-body font-medium transition-colors ${
              active
                ? 'bg-brand-50 text-brand-800 shadow-stamp'
                : 'text-ink-700 hover:bg-paper-sunken hover:text-ink-900'
            }`}
          >
            <span aria-hidden className={active ? 'text-brand-600' : 'text-ink-300'}>
              {it.icon}
            </span>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AgentsIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 13a5 5 0 0 1 10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function CorpusIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function AuditIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3.5h10v9H3z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5.5 8 1.5 1.5L10.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
