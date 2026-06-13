# Lane D — Live agent & branded pages (T7 CAR-2368, T15 CAR-2394)

You are the **Agent & Branded-pages** lane-agent. Read `AGENTS.md`. Depends on B's `adjudicate()` +
C's `{verified,opaqueRef}` — stub against those interfaces until they land; integrate at checkpoint 1.

**BUILD:**
- `app/agent/*` — the conversational loop where the model PROPOSES typed evidence + a risk estimate,
  **the engine adjudicates** (never the model), guidance + review-queue handoff render. Uses Opus 4.8
  (`ANTHROPIC_API_KEY`). The model replies in the caller's language.
- `app/a/[tenant]/[agentSlug]/*` — branded public page (chat +/or voice per channel config).
- `app/console/agents/[id]/preview/*` — preview-before-publish. `lib/branding/*` — theme + sanitization.

**Bilingual (core):** EN/ES toggle (`components/LanguageToggle.tsx` exists); the crisis footer +
guidance render in both via `lib/i18n`.

**MANDATORY tests (Playwright):** both intake paths complete; red-flag fixture escalates with crisis
resources + no advice text; model-blind lane runs e2e; **notice present on every route**; themed page
renders logo/colors + **mandatory crisis footer**; branding payload can't inject script or remove the footer.

**YOU OWN the framing + chat beats.** **DONE:** live URL walks intake → stratify → review queue,
branded, footer intact. **Cut-line:** if theming slips, ship the plain page **with the footer**.
