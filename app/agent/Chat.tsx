'use client';

/**
 * Lane D / T7 — the chat client. Renders the conversation, sends each turn to `submitTurn` (server
 * action), and shows the CANNED guidance + the provable TracePanel for the engine's decision.
 *
 * Model-blind by construction on the client too: there is no name/DOB field — only a free-text
 * symptom box. The placeholder + intro both tell the patient not to share identifiers.
 *
 * The guidance shown is the engine's canned text (from the panel), NOT the model's prose. The model's
 * reply is shown as a conversational bubble above it; the binding instruction is always the panel.
 */
import { useState, useTransition } from 'react';
import { getDict, type Lang } from '@/lib/i18n';
import type { ChatTurn } from '@/lib/agent/extract';
import type { TracePanelView } from '@/lib/agent/guidance';
import { TracePanel } from './TracePanel';
import { submitTurn } from './actions';

interface Rendered {
  history: ChatTurn[];
  panel: TracePanelView | null;
  /** The model's conversational reply for the latest turn (bubble only). */
  reply: string | null;
}

export function Chat({ agentId, lang }: { agentId?: string; lang: Lang }) {
  const t = getDict(lang).agent;
  const [input, setInput] = useState('');
  const [state, setState] = useState<Rendered>({ history: [], panel: null, reply: null });
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
      setState({ history: nextHistory, panel: res.panel, reply: res.assistantText ?? null });
    });
  }

  return (
    <div data-testid="agent-chat" className="space-y-4">
      <p className="text-sm text-gray-600">{t.intro}</p>

      {/* conversation */}
      <ol className="space-y-2">
        {state.history.map((turn, i) => (
          <li
            key={i}
            data-testid={`chat-${turn.role}`}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
              turn.role === 'user'
                ? 'ml-auto bg-brand/10 text-gray-900'
                : 'mr-auto bg-gray-100 text-gray-800'
            }`}
          >
            <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-400">
              {turn.role === 'user' ? t.youLabel : t.agentLabel}
            </span>
            {turn.text}
          </li>
        ))}
        {pending && (
          <li className="mr-auto rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-500">{t.thinking}</li>
        )}
      </ol>

      {/* the engine's binding guidance + provable trace */}
      {state.panel && (
        <div className="space-y-3">
          <div
            data-testid="guidance"
            className={`rounded-lg border p-4 ${
              state.panel.isEscalation ? 'border-crisis/40 bg-crisis/5' : 'border-brand/30 bg-brand/5'
            }`}
          >
            <p className="text-sm font-medium text-gray-900">{state.panel.guidance}</p>
          </div>
          <TracePanel panel={state.panel} lang={lang} />
        </div>
      )}

      {error && (
        <p data-testid="agent-error" className="rounded-md bg-crisis/5 p-3 text-sm text-crisis">
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
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          // Per-tenant brand via the themed wrapper's --brand; falls back to the brand token elsewhere.
          style={{ backgroundColor: 'var(--brand, #0f766e)' }}
        >
          {t.send}
        </button>
      </div>
    </div>
  );
}
