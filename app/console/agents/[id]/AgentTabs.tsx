'use client';

import { useState, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
}

/**
 * Accessible tab shell for the agent-config page (tk-0022). Client-only for the active-tab state;
 * each panel is SERVER-rendered upstream and passed in as a ReactNode, so forms stay server actions
 * and there is no client data fetching. Keyboard: arrow keys move between tabs (WAI-ARIA pattern).
 */
export function AgentTabs({ tabs, panels }: { tabs: TabDef[]; panels: Record<string, ReactNode> }) {
  const [active, setActive] = useState(tabs[0]?.id);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + dir + tabs.length) % tabs.length];
    setActive(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <div className="mt-6">
      <div
        role="tablist"
        aria-label="Agent configuration"
        className="flex flex-wrap gap-1 border-b border-ink-line"
      >
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              data-testid={`agent-tab-${tab.id}`}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`-mb-px min-h-[2.75rem] rounded-t-stamp border-b-2 px-4 text-body font-semibold transition-colors ${
                selected
                  ? 'border-brand-600 text-brand-800'
                  : 'border-transparent text-ink-500 hover:border-ink-line hover:text-ink-900'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          data-testid={`agent-panel-${tab.id}`}
          hidden={tab.id !== active}
          className="pt-6"
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}
