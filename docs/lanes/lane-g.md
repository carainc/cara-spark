# Lane G — Voice infra & phone (T13 CAR-2392, T10 CAR-2389)

You are the **Voice** lane-agent. Read `AGENTS.md`. Parallel infra track — doesn't block B–F; T10
consumes T13.

**⚠️ PROD-LiveKit/Telnyx ISOLATION (hard rule):** the existing prod LiveKit is OFF-LIMITS — EKS ns
`livekit`/LiveKitLetta, line +14157180498, trunk `ST_ogz3uBxbodYp`, rule `SDR_zBaUyhWXoddU`,
`cara-realtime`/`cara-cascade`, the Telnyx FQDN conn. Build ALL-NEW `project=cara-spark`-tagged
resources only (EC2 + docker-compose; a NEW Telnyx DID/trunk → the new EC2 EIP). Create-only/additive;
before any mutate verify the target is `cara-spark`-tagged; about to touch a prod resource → **STOP and ask.**
**A new DID needs a Telnyx top-up → 🙋 NEED YOU before any spend.**

**REUSE the proven stack** (verified-live on +14157180498; codified in `~/.claude/voice-prod-resources.txt`).
You are **packaging a working stack**, not building from scratch.

**Imports (frozen):** `@/lib/voice/types` (VoiceAgentRegistration, VoicePolicyDecisionRequest/Response,
PostCallResult). Scaffold: `docker-compose.yml` (livekit + livekit-sip + agent-worker), `config/*.yaml`,
`worker/index.mjs` (stub), `terraform/`.

**BUILD:** harden compose + terraform (single EC2 + SG + EIP). Encode the quirks: **explicit agent
dispatch** (`room_config.agents=[name]` + worker registers that name); G.711 default + jitter buffer;
Telnyx FQDN `default_primary_fqdn_id` + DTMF RFC2833 + IP-allowlist; `nat_1_to_1_ip` = EC2 EIP. Then
`lib/voice/*` (register agent + no-PHI policy-decision endpoint; post-call result → review queue).
**Bilingual:** Deepgram STT `es` + an Aura ES voice per call language.

**MANDATORY tests:** `terraform validate` + `plan` clean; an applied stack answers a real inbound call
end-to-end (preamble → cascade → policy-gated disposition); `destroy` clean; compose brings it up locally.

**YOU OWN the phone beat.** **Fallback ladder (auto, §6 G1):** standalone T13 → Cara prod voice API →
live OpenAI Realtime. One MUST answer a call. **Default demo path: the existing +14157180498 fallback rung.**
