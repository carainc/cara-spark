# Run state — PHASE 0 (pre-flight, not yet started)

Branch: `epic/fable5-build`  ·  Deploy: _none yet (local)_  ·  Updated: 2026-06-13

This file is the **resume anchor**. Any fresh context (post-compaction or fresh clone)
resumes by reading this file + `took task ready` + the branch — never re-derive, never
restart. Update it after every ticket close and every human-gate pause, then commit.

---

## Execution plan (hybrid)
- **Phase 1 (serial spine, loop):** T9 → T1 → T2 → T4 → T5 → T6 → T7
- **Phase 2 (parallel leaves):** E=T14 · G=T13→T10 · F=T11→T12 · D'=T15
- **Phase 3 (serial integration):** wire trace+audit+RAG → full e2e → rehearse 3 beats ×2

Always reconcile "what's next" against `took task ready` ∩ runbook §2 lanes.

## Lane board
| Lane | Owns | Status |
|---|---|---|
| A foundation | T9 (tk-0009) | ⬜ not started |
| B engine     | T1 (tk-0001), T2 (tk-0002), T4 (tk-0004 THIN) | ⬜ not started |
| C dataplane  | T5 (tk-0005), T6 (tk-0006) | ⬜ not started |
| D agent      | T7 (tk-0007), T15 (tk-0015) | ⛔ waits B+C |
| E auth       | T14 (tk-0014) | ⬜ not started (independent) |
| F audit/RAG  | T11 (tk-0011), T12 (tk-0012) | ⛔ waits B trace |
| G voice      | T13 (tk-0013), T10 (tk-0010) | ⬜ not started (independent) |
| addon        | T16 (tk-0016 THIN, --sim) | ⬜ optional |

## Ticket ledger
- **open:** tk-0001 tk-0002 tk-0004 tk-0005 tk-0006 tk-0007 tk-0009 tk-0010 tk-0011 tk-0012 tk-0013 tk-0014 tk-0015 tk-0016
- **cut (close with "CUT per §2"):** tk-0003 (T3 AI builder) · tk-0008 (T8 clinician console)
- **done:** _none_   ·   **in-progress:** _none_   ·   **parked:** _none_

## Open human-gates (G0 — ✅ ALL CLEAR — ready to launch)
- ✅ AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET — stored in `~/.claude/voice-run.env`. Web client,
  redirect `http://localhost:3000/api/auth/callback/google` set; **add the prod
  `https://<deploy-host>/api/auth/callback/google` URI to the SAME client once the EC2 host
  is known** (Google rejects raw IPs / non-https → deploy needs a hostname + TLS).
- ✅ AUTH_SECRET generated · SUPERADMIN_EMAIL = nils@caramedical.com
- ✅ AWS_REGION = us-east-1  ·  AWS_PROFILE = cara-prod
- ✅ ANTHROPIC credits confirmed — org holding ANTHROPIC_API_KEY has the Build-Day promo credits
- ✅ GITHUB_REPO = github.com/carainc/cara-spark (origin set)
- Remaining manual step at launch: `aws sso login --profile cara-prod` (one browser approval).

## Secrets source
All BYO keys live in `~/.claude/voice-run.env` (mode 600): LIVEKIT_*, DEEPGRAM_API_KEY,
ANTHROPIC_API_KEY, TELNYX_API_KEY, OPENAI_API_KEY, VOICE_CONFIG_HMAC_SECRET. Template into a
gitignored `.env` during BOOTSTRAP; mirror only key NAMES into `.env.example`. Never commit a
value. **Rotate Deepgram + Telnyx keys after Build Day** (shared in plaintext).

## Voice path (default)
Demo on the existing **+14157180498 fallback rung** — zero new spend, honors prod isolation.
PROD = OFF-LIMITS: connection `Cara-Prod-1` (fqdn `2818554009114118134`) → prod LiveKit ELB;
trunk `ST_ogz3uBxbodYp`; rule `SDR_zBaUyhWXoddU`; `cara-realtime`/`cara-cascade` workers; EKS
ns `livekit`/LiveKitLetta. Standalone T13 = a NEW `cara-spark`-tagged fqdn connection → the new
EC2 EIP, reusing the codified pattern (default_primary_fqdn_id, DTMF RFC2833, inbound codecs
[G711U,G711A], jitter buffer on, nat_1_to_1_ip = EC2 EIP). A new DID needs a Telnyx top-up
(balance ~$6.31) → 🙋 NEED YOU before any spend.

## Frozen-contract edits
_none_ — `engine/types.ts`, `db/schema`, `lib/identity`, `lib/voice` not yet created.
Changing a frozen contract mid-run = a coordinated edit logged here, never silent.

## Last commits
- `epic/fable5-build` created off `main`; this RUN_STATE anchor committed.

## Next autonomous step
BOOTSTRAP → confirm G0 (the 3 ⏸ items above) → start PHASE 1 at `took task claim tk-0009`
(T9 foundation: repo law + docker-compose + 4 frozen contracts + Terraform→EC2). Gate @end:
`docker compose up` boots + `terraform apply` serves an authed hello-world on the EC2.
