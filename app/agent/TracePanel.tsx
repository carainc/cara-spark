/**
 * Lane D / T7 — the PROVABLE-TRACE panel (demo beat 1). Renders, for one decision:
 *   EvidenceFacts → red-flag rule fired → π (risk estimate) → AllowedAction
 *   · PolicyBundle vN · checksum ok · signature verified
 * It makes the thesis legible: the deterministic engine, not the model, decided — and you can see why.
 *
 * Pure presentational component over the view-model from lib/agent/guidance. No PHI is rendered
 * (evidence is structured factType/value pairs; identity never appears here).
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
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm"
    >
      <h3 className="font-semibold text-gray-800">{t.title}</h3>
      <p className="mt-0.5 text-xs text-gray-500">{t.subtitle}</p>

      {/* model-proposed (evidence + π) → engine-decided (action). The core split. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-white p-2">
          <p className="text-xs font-medium text-gray-500">{t.modelProposed}</p>
          <p className="mt-1 text-xs text-gray-700">{t.evidence}</p>
          <ul className="mt-1 space-y-0.5">
            {panel.evidence.map((e, i) => (
              <li key={i} data-testid="trace-evidence" data-fact-type={e.factType} className="text-xs">
                <code className="rounded bg-gray-100 px-1">{e.factType}</code> ={' '}
                <code className="rounded bg-gray-100 px-1">{JSON.stringify(e.value)}</code>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-700">{t.risk}</p>
          <p className="mt-0.5 font-mono text-xs text-gray-600">
            {t.pRoutine} {pct(panel.risk.pRoutine)} · {t.pUrgent} {pct(panel.risk.pUrgent)} · {t.pCritical}{' '}
            {pct(panel.risk.pCritical)} · {t.confidence} {pct(panel.risk.confidence)}
          </p>
        </div>

        <div
          className={`rounded-md p-2 ${
            panel.isEscalation ? 'bg-crisis/10' : 'bg-brand/5'
          }`}
        >
          <p className="text-xs font-medium text-gray-500">{t.engineDecided}</p>
          <p className="mt-1">
            <span className="text-xs text-gray-500">{t.action}: </span>
            <code data-testid="trace-action" className="text-sm font-semibold">
              {panel.action}
            </code>
          </p>
          {panel.decisionReason && <p className="mt-1 text-xs text-gray-600">{panel.decisionReason}</p>}
          {panel.redFlagFired && (
            <p data-testid="trace-locked" className="mt-2 text-xs font-semibold text-crisis">
              ⚠ {t.escalationLocked} {t.cannotSoften}
            </p>
          )}
        </div>
      </div>

      {/* red-flag rule(s) fired → forced action */}
      <div className="mt-3 rounded-md border border-gray-200 bg-white p-2">
        <p className="text-xs font-medium text-gray-600">
          {panel.rules.length > 0 ? t.ruleFired : t.noRuleFired}
        </p>
        {panel.rules.length > 0 && (
          <ul className="mt-1 space-y-1">
            {panel.rules.map((r) => (
              <li key={r.ruleId} data-testid="trace-rule" data-rule-id={r.ruleId} className="text-xs">
                <code className="rounded bg-crisis/10 px-1 text-crisis">{r.ruleId}</code>{' '}
                <span className="text-gray-700">{r.ruleName}</span> →{' '}
                <code className="text-xs">{r.action}</code>{' '}
                <span className="text-gray-400">({t.cannedAction})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* bundle vN · checksum · signature */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-gray-100 px-2 py-0.5 font-mono">
          {t.bundle} {panel.bundleVersion}
        </span>
        <span
          data-testid="trace-checksum"
          data-valid={panel.checksumValid}
          className={`rounded px-2 py-0.5 font-medium ${
            panel.checksumValid ? 'bg-brand/10 text-brand' : 'bg-crisis/10 text-crisis'
          }`}
        >
          {panel.checksumValid ? `✓ ${t.checksumOk}` : `✗ ${t.checksumFail}`}{' '}
          <code className="text-gray-400">{panel.checksum.slice(0, 12)}…</code>
        </span>
        <span
          data-testid="trace-signature"
          className={`rounded px-2 py-0.5 font-medium ${
            panel.signatureValid ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {panel.signatureValid ? `✓ ${t.signatureOk}` : t.signatureNone}
        </span>
      </div>
    </aside>
  );
}
