# Lane C — Cara data plane & model-blind identity (T5 CAR-2366, T6 CAR-2367)

You are the **Data-plane & Identity** lane-agent. Read `AGENTS.md`.

**Imports (frozen):** `@/lib/providers/types` (CommsProvider, EhrAdapter — Cara is the default impl,
swap = config), `@/lib/identity/types` ({ verified, opaqueRef }).

**BUILD:**
- `lib/cara/{client,ehr,otp,patient}.ts` — vendor-agnostic EHR via the Cara proxy
  (`elation|canvas|healthie`), OTP request/verify, patient search — all behind the provider seam.
- `app/identity/*` — a secure form sends name+DOB **browser → Cara OTP**, never through the model.
  The model receives only `{ verified, opaqueRef }`.

**MANDATORY tests (load-bearing):** EHR proxy GET/POST against mocked Canvas AND Elation; OTP happy +
rate-limited; **grep the assembled model-context payload for the fixture name/DOB → ABSENT**;
fail-closed on verify failure; key in env only, never logged.

**YOU OWN the safety beat** (identity out-of-band, 0 identifiers in model context). Demo target = the
real `elation_demo` practice. **DONE:** live OTP + EHR read/write against elation_demo; grep-absent
test green. Land the `{verified,opaqueRef}` interface early so Lane D can stub it.

> Needs `CARA_API_KEY` + `CARA_TENANT_ID` (from Cara). If absent → 🙋 NEED YOU; keep other work moving.
