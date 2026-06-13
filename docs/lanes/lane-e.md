# Lane E — Auth & creator (T14 CAR-2393)

You are the **Auth & Creator** lane-agent. Read `AGENTS.md`. Mostly independent — you own the
standalone tenancy backbone (NOT Cara). Scaffold already present: `lib/auth.ts` (Auth.js, Google-only,
super-admin bootstrap from `SUPERADMIN_EMAIL`), `db/schema.prisma` (frozen), `app/console/*` guard.

**BUILD:**
- Harden `lib/auth/*` — roles super-admin → admin → editor; **invites** (the seeded super-admin invites
  others, who log in; a non-admin cannot invite). No hard-coded creds — bootstrap from env only.
- `app/console/agents/*` — agent CRUD + per-agent channel toggles (chat/voice/phone) wired to the
  engine (B) + the default bundle, and the voice codec (G).

**MANDATORY tests:** fresh deploy seeds exactly one super-admin from env; that user invites a second who
logs in; a non-admin cannot invite; create→configure→publish persists + drives the right runtime.

**YOU OWN the login→create→publish beat.** **DONE:** clone → deploy → log in as seeded super-admin →
create an agent, pick channels, invite a colleague. **Cut-line:** single seeded super-admin + minimal
CRUD on one tenant; drop the role-matrix if tight (the no-hard-coded-creds bootstrap is the must).

---

## Audit pins — KEEP ABOVE THE CUT-LINE (config/admin gap review, see `docs/audits/config-admin-gap-audit.md`)
These are demo-visible (Setup beat). Do NOT drop them:
- **Invite-ACCEPT flow** (not just invite-create): token link → Google sign-in → an Auth.js `signIn`
  callback consumes the `Invite`, attaches the user to the tenant with its role. "They invite the rest"
  means the second user must actually log in — it's a MANDATORY test, so this stays above the cut-line.
- **Phone-number display** on the PHONE channel: show the configured DID **read-only** (the demo uses the
  `+14157180498` fallback rung — NOT a per-agent buy-a-number flow). Enabling "phone" must surface a
  number, never an empty field.
- **Policy-bundle selector** ships as **`tk-0017`** (`GET /api/bundles` + a dropdown writing
  `Agent.policyBundleVersion`). Leave a hook in the agent form for it; until tk-0017 lands, default to
  the signed DEFAULT bundle and show "vN · verified ✓".
