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
CRUD on one tenant; drop invite/role-matrix if tight (the no-hard-coded-creds bootstrap is the must).
