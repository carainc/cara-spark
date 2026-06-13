'use client';

/**
 * Lane D / T7 — the chat client. A real multi-turn CONVERSATION: each turn goes to `submitTurn` (server
 * action) and the engine still adjudicates every turn (provable, unchanged). We INTERPRET the result:
 *
 *  - panel.turnMode === 'converse' — the engine reached "not enough info yet" (a no-red-flag,
 *    low-confidence/coverage block). We do NOT show a scary "this needs a person" card; we keep
 *    talking: the model's follow-up question is the chat bubble, and a gentle line invites the next
 *    reply. The provable trace is still available to OPERATORS under the debug toggle.
 *  - panel.turnMode === 'present' — surface the safe next step NOW: the engine's canned guidance card
 *    (+ any advisory referral). This is also the path for EVERY safety outcome — a fired red flag, an
 *    emergency escalation, or a fail-closed block — which must reach the patient immediately.
 *
 * Model-blind by construction on the client too: there is no name/DOB field — only a free-text symptom
 * box. The guidance shown is the engine's canned text (from the panel), NEVER the model's prose.
 *
 * The provable TracePanel ("Why this decision / evidence / risk / checksum / signature") is for
 * OPERATORS. In the patient chat it is COLLAPSED behind a "Show reasoning (debug)" toggle; the operator
 * preview passes `showTrace` so it renders expanded by default (beat 1 demo). The crisis SafetyFooter
 * is rendered at the root layout, so it is structurally present on every page regardless of this view.
 */
import { useState, useTransition } from 'react';
import { getDict, type Lang } from '@/lib/i18n';
import type { ChatTurn } from '@/lib/agent/extract';
import type { TracePanelView } from '@/lib/agent/guidance';
import type { ReferralView } from '@/lib/agent/loop';
import { TracePanel } from './TracePanel';
import { submitTurn } from './actions';

interface Rendered {
  history: ChatTurn[];
  panel: TracePanelView | null;
  /** The model's conversational reply for the latest turn (bubble only). */
  reply: string | null;
  /** ADVISORY referral (non-emergency only); null when none was surfaced. */
  referral: ReferralView | null;
}

export function Chat({
  agentId,
  lang,
  showTrace = false,
}: {
  agentId?: string;
  lang: Lang;
  /**
   * OPERATOR mode. When true, the provable trace renders EXPANDED by default (the operator preview
   * needs the trace visible for the beat-1 demo). Patients leave this false — the trace then lives
   * collapsed behind a "Show reasoning (debug)" toggle. Either way the patient-facing decision UI is
   * identical; this only governs whether the operator trace starts open.
   */
  showTrace?: boolean;
}) {
  const t = getDict(lang).agent;
  const [input, setInput] = useState('');
  const [state, setState] = useState<Rendered>({ history: [], panel: null, reply: null, referral: null });
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  function send() {
    const text = input.trim();
    if (!text || pending) return;
    const history: ChatTurn[] = [...state.history, { role: 'user', text }];
    setState((s) => ({ ...s, history }));
    setInput('');
    setError(false);

    start(async () => {
      const res = await submitTurn({ agentId, lang, history });
      if (!res.ok || !res.panel) {
        setError(true);
        return;
      }
      const nextHistory: ChatTurn[] = res.assistantText
        ? [...history, { role: 'assistant', text: res.assistantText }]
        : history;
      setState({
        history: nextHistory,
        panel: res.panel,
        reply: res.assistantText ?? null,
        referral: res.referral ?? null,
      });
    });
  }

  return (
    <div data-testid="agent-chat" className="space-y-5">
      <p className="rounded-card border border-ink-line bg-paper-sunken px-4 py-3 text-stamp text-ink-700">{t.intro}</p>

      {/* conversation */}
      <ol className="space-y-2.5">
        {state.history.map((turn, i) => (
          <li
            key={i}
            data-testid={`chat-${turn.role}`}
            className={`max-w-[85%] rounded-card px-4 py-2.5 ${
              turn.role === 'user'
                ? 'ml-auto rounded-br-sm bg-brand-50 text-ink-900'
                : 'mr-auto rounded-bl-sm border border-ink-line bg-paper-raised text-ink-900'
            }`}
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-300">
              {turn.role === 'user' ? t.youLabel : t.agentLabel}
            </span>
            <span className="text-body">{turn.text}</span>
          </li>
        ))}
        {pending && (
          <li className="mr-auto flex items-center gap-2 rounded-card border border-ink-line bg-paper-raised px-4 py-2.5 text-ink-500">
            <span aria-hidden className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400 [animation-delay:300ms]" />
            </span>
            {t.thinking}
          </li>
        )}
      </ol>

      {/* Engine result for the latest turn. CONVERSE → keep talking (no scary card); PRESENT → the
          binding safe next step. The provable trace is OPERATOR-only: collapsed behind a debug toggle
          for patients, expanded for operators — and shown in BOTH modes so operators can always audit. */}
      {state.panel && !pending && (
        <div className="space-y-4">
          {state.panel.turnMode === 'present' ? (
            <>
              <div
                data-testid="guidance"
                className={`rounded-card border-l-4 p-4 ${
                  state.panel.isEscalation ? 'border-crisis bg-crisis/5' : 'border-brand-600 bg-brand-50'
                }`}
              >
                <p className="text-body-lg font-medium text-ink-900">{state.panel.guidance}</p>
              </div>

              {/* ADVISORY referral (tk-0019) — non-emergency only, decision-inert. The server returns
                  null for emergencies, so this never renders alongside an escalation. */}
              {state.referral && state.referral.citations.length > 0 && (
                <section data-testid="referral" className="card p-4">
                  <h3 className="font-display text-base font-semibold text-ink-900">{t.referral.title}</h3>
                  <ul className="mt-2.5 space-y-2.5">
                    {state.referral.citations.map((c) => (
                      <li key={c.id} data-testid="referral-citation" className="rounded-stamp border border-ink-line bg-paper p-3">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-ink-900">{c.title}</span>
                          {c.category && (
                            <span className="ledger-stamp-neutral text-[10px] uppercase">{c.category}</span>
                          )}
                        </div>
                        <p className="mt-1 text-stamp text-ink-700">{c.body}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[12px] italic text-ink-500">{state.referral.advisoryNote}</p>
                </section>
              )}
            </>
          ) : (
            // CONVERSE: the engine has not reached a confident, safe next step. The model's follow-up
            // question is already in the conversation above; this line gently invites the next reply.
            // No "this needs a person" card — that is reserved for a safety block, which presents.
            <p data-testid="continue-prompt" className="rounded-card border-l-4 border-brand-300 bg-brand-50/60 p-4 text-body text-ink-700">
              {t.continuePrompt}
            </p>
          )}

          {/* OPERATOR-only provable trace. `showTrace` (operator preview) → expanded; otherwise the
              patient gets it collapsed behind the debug toggle. The TracePanel data/component is
              unchanged — we are gating its DISPLAY, not deleting it. */}
          {showTrace ? (
            <TracePanel panel={state.panel} lang={lang} />
          ) : (
            <details data-testid="reasoning-toggle" className="group rounded-card border border-ink-line bg-paper-sunken">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-stamp font-medium text-ink-600 [&::-webkit-details-marker]:hidden">
                <span>{t.showReasoning}</span>
                <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 transition-transform group-open:rotate-180">
                  <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div className="border-t border-ink-line p-3">
                <p className="mb-2 text-[12px] italic text-ink-500">{t.showReasoningHint}</p>
                <TracePanel panel={state.panel} lang={lang} />
              </div>
            </details>
          )}
        </div>
      )}

      {error && (
        <p data-testid="agent-error" className="rounded-card border-l-4 border-crisis bg-crisis/5 p-3 text-crisis">
          {t.errorGeneric}
        </p>
      )}

      {/* input — symptom text only; never an identity field */}
      <div className="flex gap-2">
        <input
          type="text"
          aria-label={t.placeholder}
          placeholder={t.placeholder}
          value={input}
          disabled={pending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          className="field flex-1"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending}
          className="btn-primary shrink-0"
          // Per-tenant brand via the themed wrapper's --brand; falls back to the brand token elsewhere.
          style={{ backgroundColor: 'var(--brand, #0f766e)' }}
        >
          {t.send}
        </button>
      </div>
    </div>
  );
}
