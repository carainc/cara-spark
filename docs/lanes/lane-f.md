# Lane F — Console & call audit + referral RAG (T11 CAR-2390, T12 CAR-2391)

You are the **Audit & RAG** lane-agent. Read `AGENTS.md`. Depends on B's JSONL trace + the
`AuditEntry`/`Call`/`ReferralResource` models (frozen in `db/schema.prisma`). Stub against B until it lands.

**BUILD (Part B is the showcase — prioritize it):**
- `app/console/calls/[id]/*` — a per-call audit trail making the deterministic decision **visible**:
  transcript turns + the decision at each step, **highlighting every rule-engine intervention** (rule
  fired → canned escalation; action blocked from the set; a disposition the model proposed but the
  engine overruled), verifiable against the bundle checksum.
- **The call-log PRODUCER (write path), not just the viewer** — on each call, persist transcript +
  decision trace + intervention flags (`AuditEntry`). No-PHI (synthetic callers + redaction).
- `lib/rag/*` + `app/console/resources/*` — upload referral docs (food banks / CHC) → chunk + embed
  (pgvector, BYO key) → retrieval the agent **cites in a referral only**, decision-inert, cannot
  override π, rejects PHI-shaped content.

**MANDATORY tests:** a completed call produces an audit entry; a red-flag fixture renders the
intervention highlighted with rule id + canned action; trace verifies against the checksum; an uploaded
food-bank resource is retrievable + cited; the RAG path cannot emit a clinical disposition.

**YOU OWN demo beats 2-replay + 3 (referral).** **Cut-lines:** ship the audit trail as a read-only page
over the engine's JSONL; RAG → curated verbatim list.
