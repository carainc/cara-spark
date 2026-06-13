/**
 * Lane D / T7 — the PROVABLE-TRACE panel (demo beat 1), elevated for tk-0015. Renders, for one
 * decision, the full causal chain TOP-TO-BOTTOM so the thesis is legible at a glance:
 *
 *   EvidenceFacts (model proposed)  →  red-flag rule fired  →  π (risk)  →  AllowedAction (engine)
 *                                    · PolicyBundle vN · checksum ok · signature verified ✓
 *
 * The trace is styled as a tamper-evident clinical receipt: a ledger-ruled card, monospace
 * verification stamps with tabular figures, and a locked escalation banner with a solid accent bar
 * that reads as structurally non-negotiable. Steps reveal in causal order (animation-delay), and
 * reduced-motion users get them instantly (globals.css).
 *
 * Pure presentational over the view-model from lib/agent/guidance. No PHI is rendered (evidence is
 * structured factType/value pairs; identity never appears here). All data-testid / data-* hooks
 * that the e2e + unit suites assert on are preserved exactly.
 */
import type { TracePanelView } from '@/lib/agent/guidance';
import { getDict, type Lang } from '@/lib/i18n';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function TracePanel({ panel, lang }: { panel: TracePanelView; lang: Lang }) {
  const t = getDict(lang).agent.trace;
  return (
    <aside
      data-testid="trace-panel"
      data-action={panel.action}
      data-red-flag={panel.redFlagFired}
      className="overflow-hidden rounded-card border border-ink-line bg-paper-raised bg-ledger-rule shadow-card"
    >
      <header className="flex items-start justify-between gap-3 border-b border-ink-line bg-paper-sunken px-5 py-3.5">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink-900">{t.title}</h3>
          <p className="mt-0.5 text-stamp text-ink-500">{t.subtitle}</p>
        </div>
        <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-stamp bg-brand-50 text-brand-700">
          <SealIcon />
        </span>
      </header>

      <div className="space-y-0 px-5 py-4">
        {/* STEP 1 — model proposed: evidence facts + π. */}
        <Step index={1} label={t.modelProposed} tone="model">
          <p className="text-stamp font-medium text-ink-700">{t.evidence}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {panel.evidence.map((e, i) => (
              <li
                key={i}
                data-testid="trace-evidence"
                data-fact-type={e.factType}
                className="ledger-stamp-neutral"
              >
                <span className="text-ink-500">{e.factType}</span>
                <span className="text-ink-300">=</span>
                <span className="text-ink-900">{JSON.stringify(e.value)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-stamp font-medium text-ink-700">{t.risk}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Metric label={t.pRoutine} value={pct(panel.risk.pRoutine)} />
            <Metric label={t.pUrgent} value={pct(panel.risk.pUrgent)} />
            <Metric label={t.pCritical} value={pct(panel.risk.pCritical)} accent />
            <Metric label={t.confidence} value={pct(panel.risk.confidence)} />
          </div>
        </Step>

        <Connector />

        {/* STEP 2 — red-flag rule(s) fired → forced action. */}
        <Step index={2} label={panel.rules.length > 0 ? t.ruleFired : t.noRuleFired} tone={panel.rules.length > 0 ? 'crisis' : 'muted'}>
          {panel.rules.length > 0 ? (
            <ul className="space-y-1.5">
              {panel.rules.map((r) => (
                <li
                  key={r.ruleId}
                  data-testid="trace-rule"
                  data-rule-id={r.ruleId}
                  className="flex flex-wrap items-center gap-1.5 text-stamp"
                >
                  <code className="ledger-stamp-fail">{r.ruleId}</code>
                  <span className="text-ink-700">{r.ruleName}</span>
                  <span aria-hidden className="text-ink-300">→</span>
                  <code className="font-mono font-medium text-crisis">{r.action}</code>
                  <span className="text-ink-300">({t.cannedAction})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-stamp text-ink-500">{t.noRuleFired}</p>
          )}
        </Step>

        <Connector />

        {/* STEP 3 — the engine's decision. The visual climax. */}
        <div
          className={`animate-rise-in rounded-card border-l-4 p-4 ${
            panel.isEscalation ? 'border-crisis bg-crisis/5' : 'border-brand-600 bg-brand-50'
          }`}
          style={{ animationDelay: '0.3s' }}
        >
          <p className={`text-stamp font-semibold uppercase tracking-wide ${panel.isEscalation ? 'text-crisis' : 'text-brand-800'}`}>
            {t.engineDecided}
          </p>
          <p className="mt-1.5">
            <span className="sr-only">{t.action}: </span>
            <code data-testid="trace-action" className="font-display text-xl font-semibold text-ink-900">
              {panel.action}
            </code>
          </p>
          {panel.decisionReason && <p className="mt-1.5 text-stamp text-ink-700">{panel.decisionReason}</p>}
          {panel.redFlagFired && (
            <p
              data-testid="trace-locked"
              className="mt-3 flex items-start gap-2 rounded-stamp bg-crisis/10 px-3 py-2 text-stamp font-semibold text-crisis"
            >
              <LockIcon />
              <span>
                {t.escalationLocked} {t.cannotSoften}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Verification footer — PolicyBundle vN · checksum · signature. The tamper-evident seal row. */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-ink-line bg-paper-sunken px-5 py-3">
        <span className="ledger-stamp-neutral animate-stamp-in" style={{ animationDelay: '0.4s' }}>
          {t.bundle} {panel.bundleVersion}
        </span>
        <span
          data-testid="trace-checksum"
          data-valid={panel.checksumValid}
          className={`animate-stamp-in ${panel.checksumValid ? 'ledger-stamp-ok' : 'ledger-stamp-fail'}`}
          style={{ animationDelay: '0.5s' }}
        >
          {panel.checksumValid ? <CheckIcon /> : <XIcon />}
          {panel.checksumValid ? t.checksumOk : t.checksumFail}
          <code className="text-ink-500">{panel.checksum.slice(0, 12)}…</code>
        </span>
        <span
          data-testid="trace-signature"
          className={`animate-stamp-in ${panel.signatureValid ? 'ledger-stamp-ok' : 'ledger-stamp-neutral'}`}
          style={{ animationDelay: '0.6s' }}
        >
          {panel.signatureValid ? <CheckIcon /> : null}
          {panel.signatureValid ? t.signatureOk : t.signatureNone}
        </span>
      </footer>
    </aside>
  );
}

/** One numbered step in the causal chain, revealed in order. */
function Step({
  index,
  label,
  tone,
  children,
}: {
  index: number;
  label: string;
  tone: 'model' | 'crisis' | 'muted';
  children: React.ReactNode;
}) {
  const dot =
    tone === 'crisis' ? 'bg-crisis text-white' : tone === 'model' ? 'bg-brand-600 text-white' : 'bg-ink-line text-ink-700';
  return (
    <div className="animate-rise-in" style={{ animationDelay: `${0.05 + index * 0.12}s` }}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={`grid h-5 w-5 place-items-center rounded-full font-mono text-[11px] font-semibold ${dot}`}>
          {index}
        </span>
        <p className="text-stamp font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      </div>
      <div className="mt-2 pl-7">{children}</div>
    </div>
  );
}

function Connector() {
  return (
    <div aria-hidden className="flex pl-2.5">
      <span className="my-1 h-5 w-px bg-ink-line" />
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-stamp border px-2 py-1.5 ${accent ? 'border-crisis/30 bg-crisis/5' : 'border-ink-line bg-paper'}`}>
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`tnum font-mono text-sm font-semibold ${accent ? 'text-crisis' : 'text-ink-900'}`}>{value}</p>
    </div>
  );
}

function SealIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="m13 4.5-7 7-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
