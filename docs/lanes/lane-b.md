# Lane B — Engine, signed bundle & eval gate (T1 CAR-2362, T2 CAR-2363, T4 CAR-2365)

You are the **Engine** lane-agent. Read the OSS laws in `AGENTS.md`.

**REUSE, don't rebuild.** The shipped VA-5 adjudicator already emits the provable trace. Port its
shape into `engine/*`. The port spec is `research/T1-va5-port-spec.md` (VA-5 source:
`pulse-mgmt-crm/lib/triage/*`). Never copy private code — port the deterministic logic.

**Imports (frozen):** `@/engine/types` (AllowedAction, EvidenceFact, RedFlagRule, PolicyBundle,
AdjudicationTrace, WorkflowState). Fill the NotImplemented stubs in
`engine/{evidence,redflags,policy,inference-check,workflow,policy-bundle,index}.ts`.

**BUILD:**
- **T1** — the four layers + `adjudicate(input): AdjudicationTrace`. `DEFAULT_POLICY` (with the
  `infant-fever-floor` rule + all 15 VA-5 default rules) so the engine runs immediately.
- **T2** — `policy-bundle.ts` checksum + version + HMAC sign/verify (uses `VOICE_CONFIG_HMAC_SECRET`
  or a dedicated key). A bundle loads only if checksum + signature valid; a tampered bundle is
  rejected before adjudication.
- **T4 (THIN)** — `evals/` release gate that `process.exit(1)`s below thresholds; Braintrust optional,
  local fallback already scaffolded in `evals/run.ts`.

**MANDATORY tests:** adjudicate returns only finite AllowedAction members; red-flag dominance;
fail-closed; inference-check; forward-only workflow; checksum stable + version bumps on change +
tampered bundle rejected; eval gate fails on a seeded false-negative + 0 adversarial reach.

**YOU OWN demo beat 1's spine.** Emit a JSONL audit trail F can read. **DONE:** unit + eval gates
green on the deployed branch. **Start FIRST — D, F, the agent depend on you.**
