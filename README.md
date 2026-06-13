# Cara Spark — Failsafe Triage Agent Creator

Open-source, BYO-key, self-hostable toolkit to create **failsafe medical-triage agents** for community
health centers (CHCs) and safety-net clinics.

A **deterministic policy engine — not the language model — makes every safety disposition**, backed by a
**signed policy bundle** and a **provable, replayable audit trace**. Reach patients however they can show
up: **chat, phone, and a one-button kiosk** — in **English and Spanish**.

> 🚧 Building in the open at the Fable 5 Build Day. Early, active development.

## Why

Accessibility first. The patients who most need triage are often the hardest to reach:

- **Phone-first** — an AI helpline reachable with no smartphone, no web, and no literacy required.
- **Bilingual (EN/ES)** end-to-end — chat, voice, and the crisis-resources footer.
- **A ~$90 kiosk box** (Raspberry Pi + one button + speaker) for people with **no phone at all** — a shelter
  or clinic waiting-room device.

## How it works

- **Four-layer deterministic engine** — typed evidence → red-flag rules → adjudication → a *finite* set of
  allowed actions. The model proposes; the engine decides. Red flags dominate; it fails closed.
- **Signed policy bundle** — versioned, checksummed, verifiable. Policy authority never comes from model or
  user text.
- **BYO-key cascade** — speech-to-text → LLM → text-to-speech, with your own keys.
- **Model-blind identity** — verified identifiers (name / DOB) are captured out-of-band; they never enter the
  model context.
- **Self-host** — `docker compose up` locally, or Terraform to a single VM. Pluggable EHR / comms / referral
  providers (bring your own).

## Status

Active build — **not yet production-ready.** This is decision-support tooling, **not medical advice and not a
substitute for emergency care.**

## License

[MIT](LICENSE)
