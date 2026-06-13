'use client';

import { useState } from 'react';
import type { BundleSummary } from '@/lib/auth/bundle';
import type { Dict } from '@/lib/i18n';

/**
 * Policy-bundle selector (tk-0017, embedded in the tabbed config). Renders the SIGNED bundles from
 * the server, lets an admin pick one, shows the live verification stamps (checksum / signature) for
 * the selection, and lists the red-flag rules the bundle escalates. Submits the chosen version via
 * the bound server action (`setPolicyBundleAction`), which is fail-closed on an unknown version.
 *
 * The bundle is a read-only contract here: this UI can pick which signed bundle is active, never
 * edit its rules or thresholds. The model can't touch it at all.
 */
export function PolicyBundleForm({
  bundles,
  currentVersion,
  action,
  t,
}: {
  bundles: BundleSummary[];
  currentVersion: string;
  action: (formData: FormData) => void | Promise<void>;
  t: Dict['agentConfig']['policies'];
}) {
  const [selected, setSelected] = useState(
    bundles.find((b) => b.version === currentVersion)?.version ?? bundles[0]?.version ?? currentVersion,
  );
  const active = bundles.find((b) => b.version === selected);

  if (bundles.length === 0) {
    return <p className="rounded-card border-l-4 border-crisis bg-crisis/5 p-3 text-crisis">{t.loadError}</p>;
  }

  return (
    <form action={action} data-testid="policy-bundle-form">
      <label className="block">
        <span className="field-label">{t.selectLabel}</span>
        <select
          name="policyBundleVersion"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          data-testid="policy-bundle-select"
          className="field max-w-md"
        >
          {bundles.map((b) => (
            <option key={b.version} value={b.version}>
              {b.version}
              {b.isDefault ? ` · ${t.defaultBadge}` : ''}
            </option>
          ))}
        </select>
      </label>

      {active && (
        <div className="card mt-4 overflow-hidden bg-ledger-rule p-0" data-testid="policy-bundle-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-line bg-paper-sunken px-4 py-3">
            <span className="ledger-stamp-neutral">
              {t.versionLabel} {active.policyVersion}
            </span>
            <span
              data-testid="bundle-checksum"
              data-valid={active.checksumValid}
              className={active.checksumValid ? 'ledger-stamp-ok' : 'ledger-stamp-fail'}
            >
              {active.checksumValid ? <CheckIcon /> : <XIcon />}
              {t.checksumOk}
              <code className="text-ink-500">{active.checksum.slice(0, 12)}…</code>
            </span>
            <span
              data-testid="bundle-signature"
              className={active.signatureValid ? 'ledger-stamp-ok' : 'ledger-stamp-neutral'}
            >
              {active.signatureValid ? <CheckIcon /> : null}
              {active.signatureValid ? t.signatureVerified : t.signatureUnsigned}
            </span>
          </div>

          <div className="px-4 py-3">
            <p className="text-stamp text-ink-500">
              {t.signedByLabel}: <code className="font-mono text-ink-700">{active.signedBy}</code>
            </p>

            <p className="mt-3 text-stamp font-semibold uppercase tracking-wide text-ink-500">{t.rulesTitle}</p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2" data-testid="bundle-rules">
              {active.redFlagRules.map((r) => (
                <li
                  key={r.id}
                  data-rule-id={r.id}
                  className="flex flex-wrap items-center gap-1.5 rounded-stamp border border-ink-line bg-paper px-2.5 py-1.5 text-stamp"
                >
                  <code className="font-mono text-ink-500">{r.id}</code>
                  <span className="text-ink-700">{r.name}</span>
                  <span aria-hidden className="text-ink-300">{t.ruleForces}</span>
                  <code className="font-mono font-medium text-crisis">{r.action}</code>
                </li>
              ))}
            </ul>

            <p className="mt-4 flex items-start gap-2 rounded-stamp bg-crisis/5 px-3 py-2 text-stamp font-medium text-crisis">
              <LockIcon />
              <span>{t.lockNote}</span>
            </p>
          </div>
        </div>
      )}

      <button type="submit" className="btn-primary mt-4" data-testid="policy-bundle-save">
        {t.save}
      </button>
    </form>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="m13 4-7 7-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0">
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
