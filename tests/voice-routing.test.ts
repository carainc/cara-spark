import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveAgentByDid,
  normalizeE164,
  equivalentDialForms,
  workerNameForAgent,
  roomPrefixFor,
  safeRoutingLog,
  type RoutingPrisma,
  type RoutableAgent,
  type RoutableChannel,
} from '@/lib/voice/routing';

/**
 * tk-0023 — inbound DID → agent routing. In-memory Prisma double (no network, no real DB).
 *
 * The double models `agent.findMany` with the exact `where` the routing query uses:
 *   status === 'PUBLISHED' AND a channel { kind:'PHONE', enabled:true, phoneNumber: { in: [...] } }.
 * The `{ in: [...] }` set is the equivalent surface forms of the dialed DID, so a row stored
 * non-normalized (e.g. `14157180498`) is still pre-filtered in; the in-process normalize re-check
 * inside resolveAgentByDid remains the authority.
 */
function makeDb(agents: RoutableAgent[]): RoutingPrisma {
  return {
    agent: {
      async findMany({ where }) {
        const want = where?.channels?.some;
        const inSet: string[] | undefined = want?.phoneNumber?.in;
        return agents.filter((a) => {
          if (where?.status && a.status !== where.status) return false;
          if (!want) return true;
          return a.channels.some(
            (c) =>
              c.kind === want.kind &&
              c.enabled === want.enabled &&
              (inSet ? inSet.includes(c.phoneNumber ?? '') : c.phoneNumber === want.phoneNumber),
          );
        });
      },
    },
  };
}

function phone(phoneNumber: string | null, enabled = true, config: unknown = null): RoutableChannel {
  return { kind: 'PHONE', enabled, phoneNumber, config };
}

function agent(over: Partial<RoutableAgent> = {}): RoutableAgent {
  return {
    id: over.id ?? 'agent_1',
    name: over.name ?? 'After-hours Triage',
    slug: over.slug ?? 'after-hours-triage',
    status: over.status ?? 'PUBLISHED',
    language: over.language ?? 'en',
    channels: over.channels ?? [phone('+14157180498')],
  };
}

describe('normalizeE164 — dialed-number canonicalization', () => {
  it('keeps an already-E.164 number', () => {
    expect(normalizeE164('+14157180498')).toBe('+14157180498');
  });
  it('prefixes + to a bare 11-digit NANP (1XXXXXXXXXX)', () => {
    expect(normalizeE164('14157180498')).toBe('+14157180498');
  });
  it('prefixes +1 to a bare 10-digit NANP', () => {
    expect(normalizeE164('4157180498')).toBe('+14157180498');
  });
  it('strips punctuation/spaces and normalizes', () => {
    expect(normalizeE164('(415) 718-0498')).toBe('+14157180498');
    expect(normalizeE164(' +1 415 718 0498 ')).toBe('+14157180498');
  });
  it('best-effort international: keeps a + and the digits', () => {
    expect(normalizeE164('+442071838750')).toBe('+442071838750');
  });
  it('returns null for empty / digitless input (fails routing closed upstream)', () => {
    expect(normalizeE164('')).toBeNull();
    expect(normalizeE164('   ')).toBeNull();
    expect(normalizeE164(null)).toBeNull();
    expect(normalizeE164(undefined)).toBeNull();
    expect(normalizeE164('abc')).toBeNull();
  });
});

describe('equivalentDialForms — storage-form pre-filter set', () => {
  it('includes the E.164, bare-digit, and NANP national forms', () => {
    const forms = equivalentDialForms('+14157180498');
    expect(forms).toContain('+14157180498'); // E.164
    expect(forms).toContain('14157180498'); // bare digits
    expect(forms).toContain('4157180498'); // national (country code dropped)
  });
  it('does not invent a national form for non-NANP numbers', () => {
    const forms = equivalentDialForms('+442071838750');
    expect(forms).toEqual(['+442071838750', '442071838750']);
  });
});

describe('resolveAgentByDid — inbound DID → published agent + dispatch', () => {
  let db: RoutingPrisma;
  const a1 = agent({ id: 'agent_1', slug: 'after-hours-triage', channels: [phone('+14157180498')] });
  const a2 = agent({ id: 'agent_2', slug: 'spanish-line', language: 'es', channels: [phone('+14155550000')] });

  beforeEach(() => {
    db = makeDb([a1, a2]);
  });

  it('resolves a dialed DID to the right published agent + dispatch name', async () => {
    const res = await resolveAgentByDid(db, '+14157180498');
    expect(res.matched).toBe(true);
    if (!res.matched) return;
    expect(res.agentId).toBe('agent_1');
    expect(res.workerName).toBe('cara-spark-after-hours-triage');
    expect(res.dispatchName).toBe('cara-spark-after-hours-triage'); // dispatchName === workerName
    expect(res.plan.roomPrefix).toBe('voicephone-agent_1-');
    expect(res.plan.workerName).toBe('cara-spark-after-hours-triage');
    expect(res.plan.attributes).toEqual({ agentId: 'agent_1', agentName: 'After-hours Triage', language: 'en' });
  });

  it('routes a different DID to a DIFFERENT agent (multi-number)', async () => {
    const res = await resolveAgentByDid(db, '+14155550000');
    expect(res.matched).toBe(true);
    if (!res.matched) return;
    expect(res.agentId).toBe('agent_2');
    expect(res.language).toBe('es');
    expect(res.workerName).toBe('cara-spark-spanish-line');
  });

  it('E.164 normalization: a non-E.164 dialed form resolves the same agent', async () => {
    // Caller dialed shapes that normalize to the stored +14157180498.
    for (const dialed of ['14157180498', '4157180498', '(415) 718-0498', '415-718-0498']) {
      const res = await resolveAgentByDid(db, dialed);
      expect(res.matched, `dialed=${dialed}`).toBe(true);
      if (res.matched) expect(res.agentId).toBe('agent_1');
    }
  });

  it('normalizes a DID stored in a non-E.164 surface form too (in-process re-check)', async () => {
    // The DB row stores the number WITHOUT a +; the dialed DID arrives WITH one. Still matches.
    const stored = agent({ id: 'agent_3', slug: 'stored-bare', channels: [phone('14159990000')] });
    const res = await resolveAgentByDid(makeDb([stored]), '+14159990000');
    expect(res.matched).toBe(true);
    if (res.matched) expect(res.agentId).toBe('agent_3');
  });

  it('prefers a workerName stashed in Channel.config (registration source of truth)', async () => {
    const withCfg = agent({
      id: 'agent_4',
      slug: 'ignored-slug',
      channels: [phone('+14157181111', true, { workerName: 'cara-spark-cascade' })],
    });
    const res = await resolveAgentByDid(makeDb([withCfg]), '+14157181111');
    expect(res.matched).toBe(true);
    if (!res.matched) return;
    expect(res.workerName).toBe('cara-spark-cascade'); // from config, not the slug fallback
    expect(res.plan.workerName).toBe('cara-spark-cascade');
  });

  // ---- FAIL-CLOSED cases (never mis-route) -------------------------------------------------

  it('fails closed (no_did) when the dialed number has no usable digits', async () => {
    const res = await resolveAgentByDid(db, '   ');
    expect(res).toEqual({ matched: false, reason: 'no_did' });
  });

  it('fails closed (no_match) for an unknown DID — never mis-routes to a wrong agent', async () => {
    const res = await resolveAgentByDid(db, '+19998887777');
    expect(res).toEqual({ matched: false, reason: 'no_match' });
  });

  it('a DRAFT agent\'s number does NOT resolve (only PUBLISHED answers)', async () => {
    const draft = agent({ id: 'agent_draft', status: 'DRAFT', channels: [phone('+14157182222')] });
    const res = await resolveAgentByDid(makeDb([draft]), '+14157182222');
    expect(res).toEqual({ matched: false, reason: 'no_match' });
  });

  it('an ARCHIVED agent\'s number does NOT resolve', async () => {
    const archived = agent({ id: 'agent_arch', status: 'ARCHIVED', channels: [phone('+14157183333')] });
    const res = await resolveAgentByDid(makeDb([archived]), '+14157183333');
    expect(res).toEqual({ matched: false, reason: 'no_match' });
  });

  it('a DISABLED phone channel does NOT resolve even on a published agent', async () => {
    const disabled = agent({ id: 'agent_dis', channels: [phone('+14157184444', false)] });
    const res = await resolveAgentByDid(makeDb([disabled]), '+14157184444');
    expect(res).toEqual({ matched: false, reason: 'no_match' });
  });

  it('a non-PHONE channel on that number does NOT resolve (defensive in-process re-check)', async () => {
    // A loose DB that returns a published agent whose only channel on the DID is VOICE, not PHONE
    // (e.g. a mis-scoped query). The in-process re-check must still refuse — fail closed.
    const guarded = agent({
      id: 'agent_voice',
      channels: [{ kind: 'VOICE', enabled: true, phoneNumber: '+14157185555', config: null }],
    });
    const looseDb: RoutingPrisma = {
      agent: { async findMany() { return [guarded]; } },
    };
    const res = await resolveAgentByDid(looseDb, '+14157185555');
    expect(res).toEqual({ matched: false, reason: 'no_match' });
  });

  it('fails closed (ambiguous) when two published agents claim the same DID — refuses to guess', async () => {
    const dup1 = agent({ id: 'dup_1', slug: 'dup-one', channels: [phone('+14157186666')] });
    const dup2 = agent({ id: 'dup_2', slug: 'dup-two', channels: [phone('+14157186666')] });
    const res = await resolveAgentByDid(makeDb([dup1, dup2]), '+14157186666');
    expect(res).toEqual({ matched: false, reason: 'ambiguous' });
  });
});

describe('routing helpers', () => {
  it('roomPrefixFor mirrors the gateway exactly', () => {
    expect(roomPrefixFor('agent_x')).toBe('voicephone-agent_x-');
  });

  it('workerNameForAgent falls back to cara-spark-<slug> without config', () => {
    expect(workerNameForAgent(agent({ slug: 'triage-es' }), phone('+1', true, null))).toBe('cara-spark-triage-es');
  });

  it('safeRoutingLog never exposes the dialed DID (no PHI) — matched', async () => {
    const res = await resolveAgentByDid(makeDb([agent()]), '+14157180498');
    const log = safeRoutingLog(res);
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain('14157180498');
    expect(log).toMatchObject({ matched: true, agentId: 'agent_1' });
  });

  it('safeRoutingLog surfaces only the reason — unmatched', () => {
    expect(safeRoutingLog({ matched: false, reason: 'no_match' })).toEqual({ matched: false, reason: 'no_match' });
  });
});
