# Cara Spark — Failsafe Triage Agent Creator

Open-source, **BYO-key**, self-hostable toolkit to create **failsafe medical-triage agents** for
community health centers (CHCs) and safety-net clinics.

The thesis in one line: **the model proposes, the deterministic engine decides.** The language model
only ever emits *typed evidence* + a *risk estimate*; a pure, fail-closed **policy engine** maps those
to one of a finite set of dispositions — backed by a **signed policy bundle** (SHA-256 checksum + HMAC
signature) and a **provable, replayable audit trace**. Red flags always dominate. The model can never
soften a fired red flag, pick the action, or write the safety guidance.

Patients reach it however they show up — **chat, standalone voice/phone, and a one-button Raspberry Pi
kiosk** — in **English and Spanish**, with a crisis/not-medical-advice footer that is structurally
impossible to remove.

> Building in the open at the Fable 5 Build Day. Active development — decision-support tooling, **not
> medical advice and not a substitute for emergency care.**

---

## 👩‍⚖️ For Build Day judges

- **Live demo:** https://spark.caramedical.com
- **Test login** (use the email/password form): `test@cara-spark.com` · password `problemsolvers` — a throwaway demo admin on the `demo-chc` tenant (rotated right after Build Day).
- **Live build-status board:** https://claude-build-day.caramedical.com/status — the autonomous build, ticket by ticket, with the run log.

**What to look at — the 3 beats:**
1. **Chat failsafe + provable trace.** Open the **Triage Demo** agent → *Preview* and describe an infant fever (e.g. "my 2-month-old has a fever of 101"). The deterministic engine forces an ED escalation the model **cannot** soften; the operator reasoning view shows the replayable trace — policy `familymed-v1` (authored by *Michael Hobbs, MD*) · checksum + signature **verified ✓**.
2. **Same guardrail on voice/phone.** The standalone voice path (Telnyx → LiveKit/SIP → cascade worker) runs through the **same** engine and signed bundle.
3. **Referral RAG / social needs.** Ask the agent for food → it routes to community resources and surfaces a food bank — advisory and **decision-inert** (it can never change a clinical disposition).

---

## Why

Accessibility is the thesis: reach the patients other tools miss.

- **Phone-first** — an AI helpline reachable with no smartphone, no web, and no literacy required.
- **Bilingual (EN/ES)** end-to-end — chat, voice, the console UI, and the crisis footer.
- **A ~$90 kiosk box** (Raspberry Pi + one button + speaker/mic) for people with **no phone at all** —
  a shelter or clinic-waiting-room device. Account-less and anonymous by design.

---

## What makes it failsafe (the architecture)

The whole product is one safety invariant, enforced by data flow rather than by trust:

```
                    ┌─────────────────────────── one turn ───────────────────────────┐
  patient speech ─► │  MODEL (Opus 4.8)            ENGINE (pure, deterministic)        │
  / chat text       │  proposes ─────────────────► decides ────────────────────────►  │ ─► policy-authored,
                    │   • typed EvidenceFacts       1. red-flag rules (DOMINATE)        │    bilingual guidance
                    │   • RiskEstimate (π)          2. abstention (confidence / OOD)    │    + provable trace
                    │   • NO action field           3. SDOH social-needs lane           │    (model can't
                    │   • NO PHI                     4. evidence-coverage gate           │     soften it)
                    │                                5. critical / urgent / routine      │
                    │                                → 1 of 6 AllowedActions             │
                    │                                against a SIGNED, verified bundle   │
                    └────────────────────────────────────────────────────────────────┘
```

The six allowed actions are a **closed set**, ordered by escalation severity
(`engine/types.ts`):

`SELF_CARE_INFO_ONLY` → `ROUTINE_REVIEW` → `SAME_DAY_REVIEW` → `IMMEDIATE_CLINIC_CALLBACK` →
`ED_OR_911_GUIDANCE` → `BLOCK_AND_HUMAN_HANDOFF`.

### The four-layer deterministic engine (`engine/`)

1. **Evidence model** (`evidence.ts`, `types.ts`) — every fact is typed, carries a source + trust
   level + provenance, and is `verified` or not. AI-generated prose can never become evidence.
2. **Red-flag rules** (`redflags.ts`) — deterministic pattern match over the facts. ALL conditions of
   a rule must match (AND); ALL matching rules fire. The demo's golden path is `infant-fever-floor`
   (age ≤ 3 mo + temp ≥ 100.4 °F → emergency).
3. **Policy adjudication** (`policy.ts`) — maps `{red-flag result, risk estimate, bundle, evidence}` →
   one action. Priority: **red-flag dominance** → abstention(confidence) → abstention(OOD) → SDOH
   social-needs lane → evidence insufficiency → critical → urgent → routine. Fail-closed: low
   confidence, high out-of-distribution score, or thin evidence all `BLOCK_AND_HUMAN_HANDOFF`.
4. **Inference check** (`inference-check.ts`) — a 12-check fail-closed gate + anti-prompt-injection.
   Any failure forces `BLOCK_AND_HUMAN_HANDOFF`; the chosen action must be in the signed bundle's
   allowed set; a prohibited summary blocks. A model cannot inject an action or smuggle prose into the
   control path.

The adjudication path is a **pure function**: no AI calls, no DB, no clock, no randomness. It is ported
from Cara's shipped VA-5 adjudicator, so the safety core is reused, not reinvented.

### Signed policy bundles (`engine/policy-bundle.ts`)

A `PolicyBundle` is the safety contract: red-flag rules + urgency thresholds + allowed actions +
prohibited output patterns. It is **tamper-evident**:

- **Checksum** — SHA-256 over a canonical JSON of the rules/thresholds/actions/patterns (metadata
  excluded). Editing any rule or threshold changes it; editing only metadata does not.
- **Signature** — a detached HMAC-SHA256 over the checksum, signed with `VOICE_CONFIG_HMAC_SECRET`.
  Verification is a real recomputation with a constant-time compare — not a label.
- **Fail-closed on tamper** (`engine/index.ts`) — a bundle that *claims* a signature but does not
  verify is refused: the engine does **not** consult its rules and returns `BLOCK_AND_HUMAN_HANDOFF`.
  An unsigned bundle still flows through the normal path (and renders "unsigned" in the trace).

Two bundles ship, both in the registry behind `GET /api/bundles` and the console **Policies & Bundles**
tab:

- **`default-0.1.0`** — 15 hand-authored default red-flag rules (11 base + 4 pediatric), signed on load.
- **`familymed-v1`** — Dr. Michael Hobbs, MD's family-medicine triage gates (Schmitt-Thompson adult
  telephone protocols, adapted; `engine/familymed-bundle.ts`). Adult/OB/older-adult escalation gates
  (ACS, stroke/BE-FAST, anaphylaxis, sepsis, AMS, OB emergencies, cauda equina, DKA, PE, and more),
  every rule authored to **escalate only** — adding gates can never introduce false reassurance.

The **provable-trace panel** (`app/agent/TracePanel.tsx`) renders the whole chain for any disposition:
`EvidenceFacts → rules fired → π → AllowedAction`, against `PolicyBundle vN · checksum ok · signature
verified ✓`.

### No-PHI, model-blind by construction

The model only ever sees an opaque identity block `{ verified, opaqueRef }` (`lib/identity/`). Name and
DOB are captured **out-of-band** (browser → Cara OTP) and never enter model context, logs, transcripts,
or audit. The audit trail stores the *trace*, not raw transcript PHI. The kiosk and voice lanes go
further: they are **anonymous** — they never collect an identifier at all.

---

## Channels

One engine, four ways in. Every channel runs the same `runTurn` loop (`lib/agent/loop.ts`).

| Channel | How it works |
|---|---|
| **Chat** (`app/agent`) | The browser conversation + the live provable-trace panel. The public, branded version lives at **`/a/<tenant>/<slug>`** once an agent is published. |
| **Standalone voice** | A Deepgram STT → Opus 4.8 brain → Deepgram Aura TTS cascade over **LiveKit + livekit-sip + Telnyx**. The `@livekit/agents` worker (`worker/index.mjs`) calls the app's `/api/voice/decide` per turn (model proposes, engine decides) and speaks only the verbatim guidance, non-interruptibly. Config in `config/sip.yaml` (carrier-quirk-encoded: G.711 codecs, jitter buffer, RFC 2833 DTMF) and `config/livekit.yaml` (`nat_1_to_1_ip` for the single-VM media path). |
| **Phone** (`app/api/voice/inbound`) | Inbound DID → owning agent routing (`lib/voice/routing.ts`). Fails closed: an unknown / draft / phone-disabled / ambiguous number is never mis-routed. |
| **Kiosk** (`app/api/kiosk/session`, `lib/kiosk/`) | A one-button, account-less Raspberry Pi box. Anonymous, device-token-authenticated, spoken-only. **See [Raspberry Pi kiosk box — manual setup](#raspberry-pi-kiosk-box--manual-setup).** |

> **Production-voice isolation (hard rule).** The standalone voice stack builds **all-new**,
> `project=cara-spark`-tagged LiveKit/Telnyx resources. It never touches Cara's live prod voice stack.

---

## Agent customization

Each agent is configured in a tabbed console (`app/console/agents/[id]`), surfacing existing backends —
nothing here adjudicates:

- **General** — per-agent **persona / system-prompt extra / additional-instructions**. These are
  **tone-only**: `buildSystemPrompt` (`lib/agent/extract.ts`) appends them *after* the hard rules,
  behind a guardrail line that re-states the non-negotiables. They can shade warmth and voice but can
  **never** introduce a clinical threshold, pick a disposition, or imply urgency.
- **Channels** — toggle CHAT / VOICE / PHONE; publish.
- **Policies & Bundles** — choose the signed bundle the engine runs against; see live "verified ✓".
- **Corpus / RAG** — upload referral resources (decision-inert; see below).
- **Preview** — the branded patient page before publishing. Public link: **`/a/<tenant>/<slug>`**.

### Referral RAG + the SDOH / social-needs lane

- **Referral RAG** (`lib/rag/`, `lib/agent/referral.ts`) — uploaded community resources (food banks,
  CHCs) are chunked + embedded into Postgres/pgvector (BYO embedding key). After a **non-emergency**
  disposition the agent may cite a nearby resource. It is **decision-inert**: it consumes
  `trace.decision.action` read-only, returns a citation or null, and can never change the action. The
  retrieval query is built from typed, model-blind evidence — never raw transcript; PHI-shaped uploads
  are rejected at ingest.
- **SDOH social-needs lane** (`engine/policy.ts`) — a *pure* resource request (food / housing /
  transport / utilities) with **zero clinical signal** and low risk is routed to a non-blocking
  `SELF_CARE_INFO_ONLY` (referral-eligible) instead of fail-closing to a human. Fail-safe by
  construction: any clinical fact, or any fired red flag, keeps the clinical engine in control.
- **Crisis footer everywhere** (`components/SafetyFooter.tsx`) — rendered at the layout level (988
  lifeline + emergency line), bilingual, structurally unremovable.

---

## Auth

- **Google OAuth** (Auth.js) **and** an email + password **credentials fallback** (bcrypt) for
  no-Google / self-host setups — the seeded super-admin and admins can log in either way.
- **Invite flow** — an invite link rides a cookie through the OAuth round-trip; the new user is
  attached to the invited tenant with the invited role.
- **Roles** — `SUPER_ADMIN` → `ADMIN` → `EDITOR`. Auth decides who may configure agents and invite —
  **never** a triage disposition (the engine owns those).

The bootstrap super-admin is seeded from `SUPERADMIN_EMAIL` on first run; an optional
`SUPERADMIN_INITIAL_PASSWORD` seeds the credentials login.

---

## The Spark → prod-voice config bridge

`GET /api/voice/config/[room]` serves a Spark-authored voice config (system prompt + greeting) to
Cara's proven prod cascade worker, using the **byte-identical `cara-voicecfg-v1` HMAC** scheme
(`lib/voice/config-signature.ts`). It fails closed on auth and on agent resolution, stays model-blind,
and serves only a prompt + greeting — never a disposition. The same secret (`VOICE_CONFIG_HMAC_SECRET`)
signs the policy bundles, the voice registration config, the worker bearer token, and the kiosk device
tokens — one tamper-evident root.

---

## Quickstart

BYO-key: bring your own provider keys. Copy the template and fill it in (it tracks every variable by
name — no values committed):

```sh
cp .env.example .env       # fill in keys (Anthropic, Deepgram, Google OAuth, AUTH_SECRET, …)
```

**Self-host (the OSS deliverable) — Docker:**

```sh
docker compose up --build  # Postgres+pgvector, Redis, app, LiveKit, livekit-sip, agent-worker
                           # (a one-shot `migrate` service applies the schema + seeds an admin)
```

**Local dev — pnpm + make:**

```sh
pnpm install
make dev                   # next dev   (Makefile maps every runbook gate to a target)
```

Common targets: `make build` · `make typecheck` · `make test` (single file: `make test ONE=…`) ·
`make lint` · `make eval` (triage release gate) · `make up` (full compose stack).

**Deploy to AWS — Terraform** (`terraform/`): a single EC2 + security group + Elastic IP runs that same
compose, with **Caddy auto-TLS** on an `<eip>.sslip.io` host (no domain required). `make deploy` runs an
AWS-session check first.

```sh
cd terraform && terraform apply   # (or `make deploy`)
```

---

## The 3-beat demo

The demo is the spec — it runs end-to-end against the deployed URL.

1. **Chat, the failsafe save** — a patient types *"my 2-month-old has a fever of 101."* The
   provable-trace panel lights up: `EvidenceFacts{age=2mo, temp=101}` → `infant-fever-floor` **FIRES**
   → π = escalate → `ED_OR_911_GUIDANCE`, against `PolicyBundle vN · checksum ok · signature verified
   ✓`. The model cannot soften it — and it never asked for a name or DOB.
2. **Same thing, live phone** — dial the number; the same guardrail fires over the Deepgram → Opus 4.8
   → Aura cascade. Hang up → the call audit trail replays with the rule-engine intervention
   highlighted.
3. **Referral RAG** — for a non-emergency, the agent surfaces a local food-bank / CHC resource from
   uploaded context — advisory, and it can never override the safety gate.

---

## Repository map

```
engine/          the deterministic triage core (types, evidence, redflags, risk, policy,
                 inference-check, policy-bundle, familymed-bundle, index). Pure, fail-closed.
lib/agent/       the loop: model PROPOSES (extract) → engine DECIDES → guidance + advisory referral.
lib/voice/       standalone voice cascade glue: routing (DID→agent), guidance, config-signature.
lib/kiosk/       the kiosk channel: device-token, session bridge, spoken guidance, redaction.
lib/identity/    {verified, opaqueRef} — model-blind identity.
lib/rag/         pgvector referral corpus (chunk, embed, retrieve) — decision-inert, PHI-rejecting.
app/             Next.js App Router: agent chat + trace, /a/<tenant>/<slug> public page,
                 console/* (auth-guarded), api/{bundles,voice,kiosk}.
worker/          the @livekit/agents standalone voice worker (Deepgram → Opus 4.8 → Aura).
config/          livekit.yaml + sip.yaml (the proven carrier quirks).
terraform/       EC2 + SG + EIP running docker-compose, Caddy auto-TLS (the AWS demo).
scripts/         kiosk-sim.mjs (the no-hardware kiosk client), deploy/smoke helpers.
db/              schema.prisma (frozen data model) + seed.
```

See **[AGENTS.md](AGENTS.md)** for the full agent playbook and the non-negotiable OSS laws.

---

## Raspberry Pi kiosk box — manual setup

A waiting-room / shelter device: **one button, no screen, no phone, no account.** A person presses the
button, speaks a symptom, and hears policy-authored, bilingual guidance from the *same* engine the chat
and phone lanes use. It is anonymous by design — the population it serves often has no account, and it
must never be asked for one.

### How the kiosk protocol actually works

This is the part that is fully implemented today and that you must wire exactly:

- **Auth is a revocable device token — not a user login.** The token is
  `ksk-v1.<deviceId>.<agentId>.<sig>`, where `<sig>` is an **HMAC-SHA256 over
  `ksk-v1:<agentId>:<deviceId>`** keyed with **`VOICE_CONFIG_HMAC_SECRET`** — the same tamper-evident
  root the voice lane uses (no new secret) (`lib/kiosk/device-token.ts`). The `deviceId` is an opaque,
  app-minted handle that carries no PHI, so a token reveals only routing identifiers and revocation is
  per-device. A forged, unsigned, wrong-secret, or cross-agent token is rejected (constant-time
  compare); auth fails **closed**.
- **The device POSTs one push-to-talk turn** to **`POST /api/kiosk/session`** with
  `Authorization: Bearer <device-token>` and a JSON body `{ agentId, lang, utterance, sessionRef }`
  (`app/api/kiosk/session/route.ts`). The route verifies the token is bound to `agentId`, then bridges
  into the shared agent loop: the model proposes typed evidence, the engine decides, and the response is
  the verbatim spoken guidance — `{ sessionRef, action, spoken, isEscalation, trace }`. On an emergency
  escalation `isEscalation` is true (play the distinct chime + red LED). The session is anonymous: the
  identity into the model is always the unverified block, and only an opaque ephemeral `sessionRef`
  groups a session's turns in the no-PHI audit trail.
- **The spoken not-emergency disclaimer plays on wake.** `GET /api/kiosk/session` returns the bilingual
  spoken disclaimer + a 988 crisis notice (TTS-shaped — "9 1 1" / "9 8 8" spelled out) — the
  screenless equivalent of the crisis footer (`lib/kiosk/spoken.ts`, `lib/i18n`). The disclaimer is,
  verbatim: *"Hi, I'm here to help you figure out what to do. This is not emergency care — if this is
  an emergency I'll help you call 9 1 1. Press the button and tell me what's going on."* (and its
  Spanish equivalent).
- **Fail-safe, never silent.** If the box cannot reach the server, or the engine is unavailable, it
  must still tell the person what to do — speak the offline line (*"I can't connect right now — please
  find on-site staff. If this is an emergency, call 9 1 1."*). The server itself fails closed: on an
  engine error it returns `503` with `failClosed: BLOCK_AND_HUMAN_HANDOFF` and the spoken disclaimer.

### Configuration

| Variable | Meaning |
|---|---|
| `VOICE_CONFIG_HMAC_SECRET` | **Required.** The HMAC root that mints/verifies the device token. Set on both the Spark deploy and the kiosk. |
| `KIOSK_URL` | Base URL of your Spark deploy (the kiosk POSTs to `<KIOSK_URL>/api/kiosk/session`). |
| `KIOSK_AGENT_ID` | The **published** agent's id the kiosk is bound to. |

`KIOSK_URL` / `KIOSK_AGENT_ID` are read by the dev simulator (and overridable with `--url` / `--agent`).
The real device sends the same `agentId` in its request body; the server only needs
`VOICE_CONFIG_HMAC_SECRET`.

### Try it with no hardware first (the simulator)

`scripts/kiosk-sim.mjs` is the **no-hardware** kiosk client — a thin client exactly like the Pi, but
push-to-"talk" is Enter on your laptop and the spoken lines print to the console. It mints a
byte-compatible device token, so what it proves is what the real device does.

```sh
# Offline: prove the device-token path + hear the bilingual disclaimer (no server needed)
node scripts/kiosk-sim.mjs --offline

# Live: exercise the real loop end-to-end against a running deploy
VOICE_CONFIG_HMAC_SECRET=… node scripts/kiosk-sim.mjs --url http://localhost:3000 --agent <agentId>
```

### Step-by-step: build the real box

> **Status note.** The **kiosk protocol** above — device token, `/api/kiosk/session`, the spoken
> disclaimer, the fail-safe offline behavior — is implemented and is what the simulator exercises. The
> **physical client** (GPIO button handling, mic capture, audio streaming/transcription on the Pi) is
> **not shipped in this repo**; the steps below are a reference build. Use the simulator's request shape
> as the contract: hold the device token, capture audio on a button press, transcribe it, POST the
> `KioskSessionRequest`, and speak back `spoken` (with a chime + red LED when `isEscalation`).

**1. Flash Raspberry Pi OS.**

- Use **Raspberry Pi Imager** to flash **Raspberry Pi OS (64-bit) Lite** to a microSD (a Pi 4 / Pi 5 /
  Pi Zero 2 W is plenty — there is no screen). In the Imager's advanced options, set the hostname, a
  user, enable SSH, and configure Wi-Fi.
- Boot, then `ssh` in and update:

  ```sh
  sudo apt update && sudo apt full-upgrade -y
  ```

**2. Install Node + dependencies.**

```sh
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
# Audio + GPIO tooling (mic/speaker via ALSA; GPIO via libgpiod)
sudo apt install -y alsa-utils libgpiod2 gpiod
node --version   # expect v20.x
```

Clone the repo so you have `scripts/kiosk-sim.mjs` (run the simulator on the Pi to confirm
connectivity + token before any wiring):

```sh
git clone https://github.com/carainc/cara-spark.git && cd cara-spark
```

**3. Wire the single button (GPIO) + speaker/mic (audio).**

- **Button:** one momentary push-button across a **GPIO pin and a ground pin** (e.g. BCM 17 / physical
  pin 11, and a GND pin). Use the Pi's internal pull-up — no external resistor needed. Press = the line
  reads low → start capture; release = stop. Verify at the shell with `gpiomon`:

  ```sh
  gpiomon --num-events=1 gpiochip0 17   # press the button; you should see one falling edge
  ```

- **Speaker + mic:** the simplest path is a **USB speaker-phone / USB sound card** (mic + speaker in
  one, line-echo handled). Confirm the devices and set defaults:

  ```sh
  aplay -l && arecord -l                 # list playback + capture devices
  speaker-test -t wav -c 2               # confirm you hear audio
  arecord -d 3 test.wav && aplay test.wav   # confirm the mic records
  ```

  Set the USB device as default in `~/.asoundrc` (or `/etc/asound.conf`) if it is not card 0.

**4. Set the environment.**

Create `/etc/cara-kiosk.env` (root-owned, `chmod 600` — it holds the HMAC secret):

```sh
KIOSK_URL=https://your-spark-deploy.example.com   # your Spark deploy's public base URL
KIOSK_AGENT_ID=<the published agent id>            # from the console (must be PUBLISHED)
VOICE_CONFIG_HMAC_SECRET=<the same secret as the Spark deploy>
KIOSK_LANG=en                                      # primary spoken language (greeting is bilingual)
```

> Mint the device token **on the device** from `VOICE_CONFIG_HMAC_SECRET` + a fresh `deviceId` (the
> simulator's `mintDeviceToken` / `lib/kiosk/device-token.ts` is the reference). Storing the *secret* on
> the box lets it derive a token and rotate its own `deviceId`; if you would rather not ship the secret
> to the field, mint the token in the console and store only the token — then revoke per device by
> rotating the secret or maintaining a deviceId denylist.

**5. Run the kiosk client.**

For development / a demo, the simulator already speaks to the live endpoint from the Pi:

```sh
set -a; . /etc/cara-kiosk.env; set +a
node scripts/kiosk-sim.mjs --url "$KIOSK_URL" --agent "$KIOSK_AGENT_ID"
```

For the production box, run your hardware client that: plays the wake disclaimer
(`GET /api/kiosk/session`), captures audio on the GPIO press, transcribes it, POSTs the
`KioskSessionRequest` to `<KIOSK_URL>/api/kiosk/session` with the Bearer device token, speaks back
`spoken`, and plays the chime + red LED when `isEscalation` is true. On any network/engine failure,
speak the offline line.

**6. Autostart on boot (systemd).**

Create `/etc/systemd/system/cara-kiosk.service`:

```ini
[Unit]
Description=Cara Spark kiosk client
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=pi
EnvironmentFile=/etc/cara-kiosk.env
WorkingDirectory=/home/pi/cara-spark
# Replace with your hardware client entrypoint; the simulator is shown for a hands-free demo box.
ExecStart=/usr/bin/node scripts/kiosk-sim.mjs --url ${KIOSK_URL} --agent ${KIOSK_AGENT_ID}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now cara-kiosk.service
journalctl -u cara-kiosk.service -f      # watch it boot + speak the disclaimer
```

`Restart=always` plus the spoken offline fallback means a flaky network never leaves the box silent: it
recovers on its own and always tells the person what to do.

---

## Security

- **No PHI** in model context, logs, comments, error messages, or string literals. Identity to the
  model is `{ verified, opaqueRef }` only; the kiosk and voice lanes are anonymous.
- **No secrets in the repo.** `.env` only (gitignored); `.env.example` tracks every variable by name.
- **Fail-closed everywhere** — unverified bundle, low confidence, thin evidence, failed inference
  check, unresolved DID, forged token → the safest action / a rejection, never a guess.
- **Production-voice isolation** — the standalone voice stack never touches Cara's prod voice
  resources.

---

## License

[MIT](LICENSE)
