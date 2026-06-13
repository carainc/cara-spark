# AGENTS.md — cara-spark

Playbook for every AI coding agent in this repo. Read it fully before touching a file.

---

## Project Overview

**Cara Spark** — an open-source, BYO-key, self-hostable **failsafe medical-triage agent creator**
for community health centers. A **deterministic policy engine — not the model — makes every safety
disposition**, backed by a **signed policy bundle** and a **provable, replayable audit trace**.
Reach patients however they show up: **chat, phone, and a one-button kiosk**, in **English and Spanish**.

**Primary language:** TypeScript · **Framework:** Next.js 15 (App Router) · **DB:** Postgres + pgvector
(one DB; no separate vector store) · **Auth:** Auth.js (Google OAuth only) · **Tests:** Vitest + Playwright.

### The non-negotiable OSS laws (runbook §3)

1. **Single-tenant.** No Cognito, no per-tenant databases, no module catalog. `Tenant` is a row.
2. **The deterministic engine decides.** The model PROPOSES typed evidence + a risk estimate; the
   engine ADJUDICATES. Red flags dominate; it fails closed. The model can NEVER soften a fired red flag.
3. **Model-blind identity.** Name / DOB are captured out-of-band (browser → Cara OTP). The model only
   ever sees `{ verified, opaqueRef }`. **No PHI in model context, logs, or transcripts — ever.**
4. **Safety footer always.** The not-medical-advice + crisis-resources footer (EN+ES) renders at the
   **layout level** — structurally impossible to ship a page without it.
5. **Bilingual EN/ES is core**, not a stretch — chat, voice, UI, and the crisis footer.
6. **No secrets in the repo.** `.env` only (gitignored). `.env.example` tracks every var (names only).
7. **PROD-LiveKit/Telnyx isolation (hard).** NEVER touch the live cara-prod voice stack (EKS ns
   `livekit`/LiveKitLetta, line +14157180498, trunk `ST_ogz3uBxbodYp`, rule `SDR_zBaUyhWXoddU`,
   `cara-realtime`/`cara-cascade`). Standalone voice builds ALL-NEW `project=cara-spark`-tagged
   resources. About to touch a prod resource → STOP and ask.

### Repository Map

```
engine/        ⛓ FROZEN engine/types.ts — the triage contract (AllowedAction, EvidenceFact,
               RedFlagRule, PolicyBundle, AdjudicationTrace, WorkflowState). Pure, deterministic.
               Stubs throw NotImplemented until T1 ports the VA-5 adjudicator.
db/schema.prisma  ⛓ FROZEN data model: Tenant/User/Agent/Channel/Invite + Call/AuditEntry + ReferralResource.
lib/identity/  ⛓ FROZEN {verified, opaqueRef} — model-blind identity.
lib/voice/     ⛓ FROZEN register-agent + post-call-result.
lib/providers/ swappable comms/EHR seam (Cara is the default impl).
lib/i18n/      EN/ES dictionaries. components/SafetyFooter.tsx renders at the layout level.
app/           Next.js App Router. app/console/* is auth-guarded.
evals/         local triage release gate (sensitivity / false-reassurance / adversarial-0-reach).
fixtures/      SYNTHETIC no-PHI cases (incl. the infant-fever golden path + a Spanish case).
docs/lanes/    the 6 lane kickoff prompts — read your lane before building.
terraform/     EC2 + SG + EIP running docker-compose (the AWS demo).
```

---

## Build and Test Commands

```sh
make build      # prisma generate + next build
make typecheck  # tsc --noEmit
make test       # vitest run     (single file: make test ONE=engine/__tests__/adjudicate.test.ts)
make lint       # next lint
make eval       # triage release gate (local fallback)
make up         # docker compose up (full stack)
make deploy     # aws_session_ok + terraform apply  (deploy gate)
```

Run `make typecheck && make test` before considering any implementation complete.

---

## Code-Style Guidelines

- **Imports:** absolute via `@/*` (e.g. `import { adjudicate } from '@/engine'`).
- **Prefer REUSE over rebuild.** The engine ports the shipped VA-5 adjudicator (see
  `research/T1-va5-port-spec.md`). Don't reinvent what exists.
- **FROZEN contracts** (`engine/types.ts`, `db/schema.prisma`, `lib/identity/types.ts`,
  `lib/voice/types.ts`): changing one mid-build is a **coordinated edit logged in `RUN_STATE.md`** —
  never silent. Build against the types.
- Keep diffs small and scoped to the ticket.

---

## Testing Instructions

Unit tests in `engine/**` and `lib/**` (Vitest); e2e in `e2e/` (Playwright). Every behavior change
ships with a runnable test. **Never** write a test that depends on real network/PHI. Engine tests are
pure. The eval gate (`make eval`) is the orchestration artifact a judge can re-run.

---

## Security Considerations

- **No PHI** in model context, logs, comments, error messages, or string literals. Audit stores the
  *trace*, not raw transcript PHI. Transcripts use synthetic callers + redaction.
- **Secrets:** env only. Never commit `.env`. Keep `.env.example` current (names only).
- **Deploys/migrations are irreversible** — document the rollback. `aws_session_ok` before any deploy.
- **Prod-LiveKit/Telnyx isolation** as above.

---

## Environment Variables

All documented in `.env.example`. Copy to `.env` before running. Never commit `.env`.

---

## Took Commands for Agents

- `took task ready` / `took task claim <id>` / `took task close <id>` — the git-native task graph.
- `took recall "<query>"` before reading whole files. `took diff` before committing.
- Reference the ticket in commits with a `Took-Task:` trailer.

*Resume anchor is `RUN_STATE.md`. Read it + `took task ready` + the branch to continue — never re-derive.*
