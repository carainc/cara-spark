/**
 * Per-call AUDIT TRAIL viewer (T11) — demo beat 2-replay. Renders each recorded step: the model's
 * risk estimate, the deterministic decision, and — HIGHLIGHTED — every engine intervention:
 *   • a red-flag rule fired → canned escalation (rule id + forced action shown);
 *   • the engine OVERRULED a disposition the model proposed;
 *   • an action was BLOCKED → human handoff (fail-closed).
 * Each step is verifiable: its stored checksum is recomputed from the policy bundle and shown
 * PASS/FAIL. No raw transcript PHI is ever rendered — only the structured, PHI-free trace.
 *
 * Server component; reads Prisma directly. The crisis/not-medical-advice footer renders at the root
 * layout, so it is structurally present here too.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getDict } from '@/lib/i18n';
import { getLang } from '@/lib/i18n/server';
import { toCallTrailView, type StoredAuditEntry } from '@/lib/audit/view';
import { resolveBundle } from '@/lib/audit/bundle-resolver';
import { getActiveTenantId } from '@/lib/audit/tenant';
import type { Dict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

type CallsDict = Dict['calls'];

function InterventionBadge({ kinds, t }: { kinds: string[]; t: CallsDict }) {
  if (kinds.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
        ✓ {t.noIntervention}
      </span>
    );
  }
  const label = (k: string) =>
    k === 'red_flag_escalation' ? t.redFlagEscalation : k === 'engine_overruled_model' ? t.overruled : t.blocked;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {kinds.map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded-full bg-crisis/10 px-2 py-0.5 text-xs font-semibold text-crisis"
        >
          ⚠ {label(k)}
        </span>
      ))}
    </span>
  );
}

export default async function CallTrailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = getDict(await getLang()).calls;
  const tenantId = await getActiveTenantId();

  const call = await prisma.call.findFirst({
    where: { id, ...(tenantId ? { agent: { tenantId } } : {}) },
    include: { agent: { select: { name: true } }, auditEntries: true },
  });
  if (!call) notFound();

  const entries = call.auditEntries as unknown as StoredAuditEntry[];
  // Resolve the policy bundle for the recorded version → re-verify each step's checksum.
  const bundleVersion = entries[0]?.bundleVersion ?? '';
  const bundle = resolveBundle(bundleVersion) ?? undefined;
  const trail = toCallTrailView(entries, bundle);

  return (
    <section className="mx-auto max-w-3xl">
      <Link href="/console/calls" className="text-sm text-brand hover:underline">
        ← {t.backToCalls}
      </Link>

      <div className="mt-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{t.title}</h1>
        {trail.allVerified !== null && (
          <span
            data-testid="trail-verify"
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              trail.allVerified ? 'bg-brand/10 text-brand' : 'bg-crisis/10 text-crisis'
            }`}
          >
            {trail.allVerified ? `✓ ${t.bundleVerified}` : `✗ ${t.bundleFailed}`}
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-gray-500">{t.channel}</dt>
          <dd className="font-medium">{call.channel}</dd>
        </div>
        <div>
          <dt className="text-gray-500">{t.language}</dt>
          <dd className="font-medium">{call.language}</dd>
        </div>
        <div>
          <dt className="text-gray-500">{t.disposition}</dt>
          <dd>
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{call.disposition ?? '—'}</code>
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">{t.bundleVersion}</dt>
          <dd className="font-mono text-xs">{bundleVersion || '—'}</dd>
        </div>
      </dl>

      <ol className="mt-6 space-y-4">
        {trail.steps.map((s) => (
          <li
            key={s.id}
            data-testid="audit-step"
            data-intervention={s.intervention}
            className={`rounded-lg border p-4 ${
              s.intervention ? 'border-crisis/40 bg-crisis/5' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t.step} {s.seq + 1}
              </span>
              <InterventionBadge kinds={s.interventionKinds} t={t} />
            </div>

            {/* model-proposed vs engine-decided — the core "the engine, not the model, decides" view */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-gray-50 p-2">
                <p className="text-xs text-gray-500">{t.modelProposed}</p>
                <code className="text-sm">{s.modelProposedAction ?? '—'}</code>
              </div>
              <div className={`rounded-md p-2 ${s.intervention ? 'bg-crisis/10' : 'bg-brand/5'}`}>
                <p className="text-xs text-gray-500">{t.engineDecided}</p>
                <code className="text-sm font-semibold">{s.engineAction ?? '—'}</code>
              </div>
            </div>

            {/* fired rules → canned action */}
            {s.redFlagResult.hits.length > 0 && (
              <div className="mt-3 rounded-md border border-crisis/30 bg-white p-2">
                <p className="text-xs font-semibold text-crisis">{t.ruleFired}</p>
                <ul className="mt-1 space-y-1">
                  {s.redFlagResult.hits.map((h) => (
                    <li key={h.ruleId} className="text-sm" data-testid="rule-hit" data-rule-id={h.ruleId}>
                      <code className="rounded bg-crisis/10 px-1 text-xs text-crisis">{h.ruleId}</code>{' '}
                      <span className="text-gray-700">{h.ruleName}</span> →{' '}
                      <code className="text-xs">{h.action}</code>{' '}
                      <span className="text-gray-400">({t.cannedAction})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* decision reason */}
            {s.decision?.decisionReason && (
              <p className="mt-3 text-xs text-gray-600">{s.decision.decisionReason}</p>
            )}

            {/* per-step checksum verification */}
            {s.checksumVerified !== null && (
              <p className="mt-2 text-xs" data-testid="step-verify" data-verified={s.checksumVerified}>
                {s.checksumVerified ? (
                  <span className="text-brand">✓ {t.bundleVerified} — {t.verifyNote}</span>
                ) : (
                  <span className="text-crisis">✗ {t.bundleFailed}</span>
                )}{' '}
                <code className="text-gray-400">{s.bundleChecksum.slice(0, 12)}…</code>
              </p>
            )}

            {/* evidence (structured, PHI-free) */}
            {s.evidence.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-gray-500">{t.evidence}</summary>
                <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                  {s.evidence.map((e) => (
                    <li key={e.id}>
                      <code>{e.factType}</code> = <code>{JSON.stringify(e.value)}</code>{' '}
                      <span className="text-gray-400">({e.source})</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
