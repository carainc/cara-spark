# Config / Admin UI + API gap audit

**Scope:** the config/admin surface (super-admin, agent creator, channels, branding, resources,
audit) vs. the 3-beat demo (runbook §1), the frozen `db/schema.prisma`, and the lane specs
(E/D/F). Run while the autonomous build was at T9 (scaffold done) / T1 closed / T2 claimed.

**Verdict:** the data model covers config/admin cleanly (no schema gaps). Gaps are in *which lane
builds the UI/API* on top of it, plus two demo-visible surfaces with no clear owner.

This doc is the durable artifact; the `/loop` config-admin monitor appends timestamped re-audits
below as the owning lanes close. Do not store this in RUN_STATE.md (the build agent rewrites that).

## Findings

| # | Surface | Demo beat | Owner | Gap | Sev | Action |
|---|---|---|---|---|---|---|
| 1 | Policy-bundle picker ("pick the triage policy bundle") | Setup | none (T3+T8 CUT; T14 wires *default* only) | No UI/API to list signed bundles or assign one to an agent; `Agent.policyBundleVersion` only ever = DEFAULT | **HIGH** | **Filed `tk-0017`** (dep tk-0002, tk-0014) |
| 2 | Invite-ACCEPT flow ("they invite the rest") | Setup | T14 | Invite *create* in T14, but accept path (token→Google→attach user to tenant+role) unscaffolded and is what T14's cut-line drops | **MED** | **Pinned above cut-line in `lane-e.md`** |
| 3 | Phone-number display on PHONE channel | Setup | T14 / T10 | Enabling "phone" needs a number; fallback rung (+14157180498) is shared/prod → must show the configured DID read-only, not a buy-a-number flow | **MED** | **Pinned above cut-line in `lane-e.md`** |
| 4 | Tenant/org settings page (org brand + defaultLanguage) | Frame | none (T15 = *agent* branding) | `Tenant.brandLogoUrl/brandColor/defaultLanguage` editable by nothing | LOW | Deferred — do if time |
| 5 | Integration-status endpoint (Cara/LiveKit/Telnyx/Anthropic configured?) | — | none | pulse had `/api/v1/settings/voice`; Cara Spark has none | LOW | Deferred — nice for demo/debug |
| 6 | Kiosk device-token admin (mint/list) | Kiosk addon | T16 (THIN) | If T16 ships, no admin UI to issue device tokens | LOW | Deferred — THIN addon |

Covered (no gap): agent CRUD + publish + channel toggles (T14), branded page + preview (T15),
resources upload + call-audit viewer + RAG (T11/T12), super-admin bootstrap (scaffolded).

## Re-audit log (appended by the monitor)
- 2026-06-13 — initial audit. tk-0017 filed; lane-e.md pins added. Owning lanes (T11/T14/T15/tk-0017)
  still open → nothing to re-verify yet.
