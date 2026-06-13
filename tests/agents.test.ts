import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAgent,
  configureChannels,
  publishAgent,
  slugify,
  updateAgentCustomization,
  agentPublicUrl,
  type AgentPrisma,
  type AgentRow,
  type ChannelRow,
} from '@/lib/auth/agents';
import { DEFAULT_POLICY_BUNDLE_VERSION } from '@/lib/auth/bundle';
import type { ChannelKind } from '@prisma/client';

/** In-memory Prisma double for agent + channel — no network, no real DB. */
function makeDb() {
  const agents: AgentRow[] = [];
  const channels: ChannelRow[] = [];
  let seq = 0;

  const db: AgentPrisma = {
    agent: {
      async create({ data }) {
        const row: AgentRow = {
          id: `agent_${++seq}`,
          tenantId: data.tenantId as string,
          name: data.name as string,
          slug: data.slug as string,
          status: data.status as AgentRow['status'],
          policyBundleVersion: data.policyBundleVersion as string,
          language: data.language as AgentRow['language'],
        };
        agents.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = agents.find((a) => a.id === where.id);
        if (!row) throw new Error('agent not found');
        Object.assign(row, data);
        return row;
      },
      async findUnique({ where }) {
        const row = agents.find((a) => a.id === where.id);
        if (!row) return null;
        return { ...row, channels: channels.filter((c) => c.agentId === row.id) };
      },
    },
    channel: {
      async upsert({ where, update, create }) {
        const existing = channels.find(
          (c) => c.agentId === where.agentId_kind.agentId && c.kind === where.agentId_kind.kind,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: ChannelRow = {
          id: `chan_${++seq}`,
          agentId: create.agentId as string,
          kind: create.kind as ChannelKind,
          enabled: create.enabled as boolean,
          phoneNumber: (create.phoneNumber as string | null) ?? null,
        };
        channels.push(row);
        return row;
      },
    },
  };
  return { db, agents, channels };
}

const TENANT = 'tenant_demo';

describe('agent create → configure → publish persists', () => {
  let store: ReturnType<typeof makeDb>;
  beforeEach(() => {
    store = makeDb();
  });

  it('slugify makes a URL-safe slug', () => {
    expect(slugify('After-Hours Triage!')).toBe('after-hours-triage');
    expect(slugify('   ')).toBe('agent');
  });

  it('creates a DRAFT agent defaulted to the signed DEFAULT bundle', async () => {
    const agent = await createAgent(store.db, { actorRole: 'EDITOR', tenantId: TENANT, name: 'After-hours' });
    expect(agent.status).toBe('DRAFT');
    expect(agent.policyBundleVersion).toBe(DEFAULT_POLICY_BUNDLE_VERSION);
    expect(agent.slug).toBe('after-hours');
    expect(store.agents).toHaveLength(1);
  });

  it('the full beat: create → toggle chat+phone → publish, all persisted', async () => {
    const agent = await createAgent(store.db, { actorRole: 'ADMIN', tenantId: TENANT, name: 'Triage' });

    await configureChannels(store.db, {
      actorRole: 'ADMIN',
      agentId: agent.id,
      channels: { CHAT: true, VOICE: false, PHONE: true },
    });

    const published = await publishAgent(store.db, { actorRole: 'ADMIN', agentId: agent.id });
    expect(published.status).toBe('PUBLISHED');

    const fresh = await store.db.agent.findUnique({ where: { id: agent.id }, include: { channels: true } });
    const byKind = new Map(fresh!.channels!.map((c) => [c.kind, c]));
    expect(byKind.get('CHAT')?.enabled).toBe(true);
    expect(byKind.get('VOICE')?.enabled).toBe(false);
    expect(byKind.get('PHONE')?.enabled).toBe(true);
  });

  it('enabling PHONE surfaces a read-only DID — never an empty field', async () => {
    const agent = await createAgent(store.db, { actorRole: 'ADMIN', tenantId: TENANT, name: 'Phone agent' });
    const rows = await configureChannels(store.db, {
      actorRole: 'ADMIN',
      agentId: agent.id,
      channels: { PHONE: true },
    });
    const phone = rows.find((r) => r.kind === 'PHONE');
    expect(phone?.phoneNumber).toBeTruthy();
    expect(phone?.phoneNumber).toMatch(/^\+\d{6,}$/);
  });

  it('toggling a channel off clears its phone number', async () => {
    const agent = await createAgent(store.db, { actorRole: 'ADMIN', tenantId: TENANT, name: 'Toggle agent' });
    await configureChannels(store.db, { actorRole: 'ADMIN', agentId: agent.id, channels: { PHONE: true } });
    const off = await configureChannels(store.db, {
      actorRole: 'ADMIN',
      agentId: agent.id,
      channels: { PHONE: false },
    });
    expect(off.find((r) => r.kind === 'PHONE')?.enabled).toBe(false);
    expect(off.find((r) => r.kind === 'PHONE')?.phoneNumber).toBeNull();
  });

  it('a user with no role cannot create/configure/publish', async () => {
    await expect(createAgent(store.db, { actorRole: null, tenantId: TENANT, name: 'X' })).rejects.toThrow(
      /forbidden/i,
    );
    await expect(
      configureChannels(store.db, { actorRole: undefined, agentId: 'a', channels: { CHAT: true } }),
    ).rejects.toThrow(/forbidden/i);
    await expect(publishAgent(store.db, { actorRole: null, agentId: 'a' })).rejects.toThrow(/forbidden/i);
  });
});

describe('agent customization (tk-0015) — persona / extra prompt / additional instructions', () => {
  let store: ReturnType<typeof makeDb>;
  beforeEach(() => {
    store = makeDb();
  });

  it('saves persona + system-prompt extra + additional instructions on the agent', async () => {
    const agent = await createAgent(store.db, { actorRole: 'ADMIN', tenantId: TENANT, name: 'Custom' });
    const updated = await updateAgentCustomization(store.db, {
      actorRole: 'ADMIN',
      agentId: agent.id,
      persona: 'Warm, plain-language, reassuring.',
      systemPromptExtra: 'Use short sentences.',
      additionalInstructions: 'Avoid medical jargon.',
    });
    expect(updated.persona).toBe('Warm, plain-language, reassuring.');
    expect(updated.systemPromptExtra).toBe('Use short sentences.');
    expect(updated.additionalInstructions).toBe('Avoid medical jargon.');
  });

  it('trims fields and stores an empty/whitespace box as null (cleared → base prompt)', async () => {
    const agent = await createAgent(store.db, { actorRole: 'ADMIN', tenantId: TENANT, name: 'Trim' });
    const updated = await updateAgentCustomization(store.db, {
      actorRole: 'ADMIN',
      agentId: agent.id,
      persona: '  spaced  ',
      systemPromptExtra: '   ',
      additionalInstructions: '',
    });
    expect(updated.persona).toBe('spaced');
    expect(updated.systemPromptExtra).toBeNull();
    expect(updated.additionalInstructions).toBeNull();
  });

  it('is role-guarded — a user with no manage capability cannot customize', async () => {
    await expect(
      updateAgentCustomization(store.db, { actorRole: null, agentId: 'a', persona: 'x' }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe('agentPublicUrl — the published agent’s public /a/<tenant>/<slug> link', () => {
  it('builds <base>/a/<tenant-slug>/<agent-slug>', () => {
    expect(agentPublicUrl('https://triage.example.org', 'westside-chc', 'after-hours')).toBe(
      'https://triage.example.org/a/westside-chc/after-hours',
    );
  });

  it('is trailing-slash safe on the base origin', () => {
    expect(agentPublicUrl('http://localhost:3000/', 'demo', 'intake')).toBe(
      'http://localhost:3000/a/demo/intake',
    );
    expect(agentPublicUrl('http://localhost:3000///', 'demo', 'intake')).toBe(
      'http://localhost:3000/a/demo/intake',
    );
  });

  it('matches the slug a created agent actually gets (round-trip with slugify)', () => {
    const slug = slugify('After-Hours Triage!');
    expect(agentPublicUrl('https://app.test', 'clinica-norte', slug)).toBe(
      'https://app.test/a/clinica-norte/after-hours-triage',
    );
  });
});
