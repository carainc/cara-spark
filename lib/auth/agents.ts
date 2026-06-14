/**
 * Agent CRUD + per-agent channel toggles (T14 / Lane E — the create→configure→publish beat).
 *
 *  - create:    a DRAFT agent on the actor's tenant, defaulted to the signed DEFAULT bundle.
 *  - configure: toggle chat / voice / phone channels (upserted per kind). Enabling PHONE stamps
 *               the read-only demo DID so the number is never blank.
 *  - publish:   flip status → PUBLISHED. This is what the runtime (engine B / voice G) reads to
 *               know an agent is live; auth only sets the row, it never adjudicates anything.
 *
 * All functions take an injected Prisma-like client + the actor's role so they are guarded and
 * unit-testable with a mock (no network). The deterministic engine owns dispositions — not this.
 */
import type { AgentStatus, ChannelKind, Language, Role } from '@prisma/client';
import { canManageAgents } from './roles';
import { DEFAULT_POLICY_BUNDLE_VERSION, demoPhoneDid, isKnownBundleVersion } from './bundle';

/** Channels the creator can toggle in the console (KIOSK is provisioned elsewhere). */
export const TOGGLEABLE_CHANNELS = ['CHAT', 'VOICE', 'PHONE'] as const;
export type ToggleableChannel = (typeof TOGGLEABLE_CHANNELS)[number];

export interface AgentRow {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  status: AgentStatus;
  policyBundleVersion: string;
  language: Language;
  // Agent customization (tk-0015) — TONE/STYLE only; the engine still owns every disposition.
  persona?: string | null;
  systemPromptExtra?: string | null;
  additionalInstructions?: string | null;
}

export interface ChannelRow {
  id: string;
  agentId: string;
  kind: ChannelKind;
  enabled: boolean;
  phoneNumber: string | null;
}

/**
 * Narrow structural slice of PrismaClient used by the agent services. Arg types are loose (`any`)
 * so both the real `PrismaClient` and a test mock satisfy it; return types stay strict.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AgentPrisma {
  agent: {
    create(args: { data: any }): Promise<AgentRow>;
    update(args: { where: any; data: any }): Promise<AgentRow>;
    findUnique(args: { where: any; include?: any }): Promise<(AgentRow & { channels?: ChannelRow[] }) | null>;
  };
  channel: {
    upsert(args: {
      where: { agentId_kind: { agentId: string; kind: ChannelKind } };
      update: any;
      create: any;
    }): Promise<ChannelRow>;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** slugify a display name → URL-safe, lower-kebab. Empty input falls back to "agent". */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'agent';
}

export interface CreateAgentInput {
  actorRole: Role | undefined | null;
  tenantId: string;
  name: string;
  language?: Language;
}

/** Create a DRAFT agent on the actor's tenant. Guarded: a user with no manage capability is
 *  rejected. Defaults to the signed DEFAULT policy bundle (tk-0017 will let admins switch). */
export async function createAgent(db: AgentPrisma, input: CreateAgentInput): Promise<AgentRow> {
  if (!canManageAgents(input.actorRole)) throw new Error('Forbidden: insufficient role to create an agent.');
  const name = input.name.trim();
  if (!name) throw new Error('An agent name is required.');
  return db.agent.create({
    data: {
      tenantId: input.tenantId,
      name,
      slug: slugify(name),
      status: 'DRAFT',
      policyBundleVersion: DEFAULT_POLICY_BUNDLE_VERSION,
      language: input.language ?? 'EN',
    },
  });
}

/**
 * Tenant-isolation guard (SOC2/HITRUST). A write MUST target an agent in the actor's tenant. The
 * detail page guards the GET render (app/console/agents/[id]/page.tsx), but server actions are
 * independently POST-able — so every write path re-verifies ownership here and fails CLOSED (throws)
 * on a cross-tenant or unknown agentId. Uses the existing findUnique + an explicit tenant compare.
 */
async function assertAgentInTenant(db: AgentPrisma, agentId: string, tenantId: string): Promise<void> {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.tenantId !== tenantId) {
    throw new Error('Forbidden: agent not found in your tenant.');
  }
}

export interface ChannelToggleInput {
  actorRole: Role | undefined | null;
  /** The actor's tenant — every write is scoped to it; a cross-tenant agentId is rejected. */
  tenantId: string;
  agentId: string;
  /** Desired enabled-state per channel kind; omit a kind to leave it untouched. */
  channels: Partial<Record<ToggleableChannel, boolean>>;
}

/**
 * Configure an agent's channel toggles. Enabling PHONE attaches the read-only demo DID (never an
 * empty field); disabling clears nothing destructive. Returns the upserted channel rows.
 */
export async function configureChannels(db: AgentPrisma, input: ChannelToggleInput): Promise<ChannelRow[]> {
  if (!canManageAgents(input.actorRole)) throw new Error('Forbidden: insufficient role to configure an agent.');
  await assertAgentInTenant(db, input.agentId, input.tenantId);
  const out: ChannelRow[] = [];
  for (const kind of TOGGLEABLE_CHANNELS) {
    const desired = input.channels[kind];
    if (desired === undefined) continue;
    // PHONE always surfaces a number when enabled — sourced from config, display-only.
    const phoneNumber = kind === 'PHONE' && desired ? demoPhoneDid() : null;
    const row = await db.channel.upsert({
      where: { agentId_kind: { agentId: input.agentId, kind } },
      update: { enabled: desired, phoneNumber },
      create: { agentId: input.agentId, kind, enabled: desired, phoneNumber },
    });
    out.push(row);
  }
  return out;
}

export interface PublishAgentInput {
  actorRole: Role | undefined | null;
  tenantId: string;
  agentId: string;
}

/** Flip an agent to PUBLISHED — the runtime reads this. Guarded by manage capability + tenant. */
export async function publishAgent(db: AgentPrisma, input: PublishAgentInput): Promise<AgentRow> {
  if (!canManageAgents(input.actorRole)) throw new Error('Forbidden: insufficient role to publish an agent.');
  await assertAgentInTenant(db, input.agentId, input.tenantId);
  return db.agent.update({ where: { id: input.agentId }, data: { status: 'PUBLISHED' } });
}

export interface SetPolicyBundleInput {
  actorRole: Role | undefined | null;
  tenantId: string;
  agentId: string;
  /** A version string from the available signed bundles (GET /api/bundles). */
  policyBundleVersion: string;
}

/**
 * Set the agent's policy bundle (tk-0017). Writes ONLY Agent.policyBundleVersion — the runtime
 * resolves the signed bundle from this string. Guarded by manage capability AND fail-closed on an
 * unknown version: an arbitrary string can never become an agent's safety contract. Auth still
 * never adjudicates — it only records which signed bundle the deterministic engine should load.
 */
export async function setAgentPolicyBundle(db: AgentPrisma, input: SetPolicyBundleInput): Promise<AgentRow> {
  if (!canManageAgents(input.actorRole)) throw new Error('Forbidden: insufficient role to change the policy bundle.');
  if (!isKnownBundleVersion(input.policyBundleVersion)) {
    throw new Error(`Unknown policy bundle version: ${input.policyBundleVersion}`);
  }
  await assertAgentInTenant(db, input.agentId, input.tenantId);
  return db.agent.update({
    where: { id: input.agentId },
    data: { policyBundleVersion: input.policyBundleVersion },
  });
}

export interface UpdateAgentCustomizationInput {
  actorRole: Role | undefined | null;
  tenantId: string;
  agentId: string;
  /** Short tone note. Empty/whitespace clears it (→ null). */
  persona?: string | null;
  /** Extra system-prompt text. Empty/whitespace clears it (→ null). */
  systemPromptExtra?: string | null;
  /** Extra task/style guidance. Empty/whitespace clears it (→ null). */
  additionalInstructions?: string | null;
}

/** Trim a free-text field; empty/whitespace becomes null so a cleared box round-trips to NULL. */
function normalizeText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Update an agent's TONE/STYLE customization (tk-0015): persona, extra system-prompt text, and
 * additional instructions. Guarded by manage capability. These fields tune the conversational VOICE
 * ONLY — they are appended to the model's system prompt AFTER the hard rules under a guardrail (see
 * lib/agent/extract.ts buildSystemPrompt) and can NEVER change the engine's disposition. Auth still
 * never adjudicates: it only records the voice the model speaks in. Each field is trimmed; an empty
 * box is stored as NULL so the base prompt is used unchanged.
 */
export async function updateAgentCustomization(
  db: AgentPrisma,
  input: UpdateAgentCustomizationInput,
): Promise<AgentRow> {
  if (!canManageAgents(input.actorRole)) {
    throw new Error('Forbidden: insufficient role to customize an agent.');
  }
  await assertAgentInTenant(db, input.agentId, input.tenantId);
  return db.agent.update({
    where: { id: input.agentId },
    data: {
      persona: normalizeText(input.persona),
      systemPromptExtra: normalizeText(input.systemPromptExtra),
      additionalInstructions: normalizeText(input.additionalInstructions),
    },
  });
}

/**
 * Build the PUBLIC link to a PUBLISHED agent's branded page. The route is `/a/{tenant}/{agentSlug}`
 * (app/a/[tenant]/[agentSlug]), so the URL is `<base>/a/<tenant-slug>/<agent-slug>`. `base` is the
 * deploy's public origin — `AUTH_URL` (mirrored to NEXTAUTH_URL) or the request origin. Pure +
 * trailing-slash safe so it is trivially unit-testable. Slugs are already URL-safe (see `slugify`).
 */
export function agentPublicUrl(base: string, tenantSlug: string, agentSlug: string): string {
  const origin = base.replace(/\/+$/, '');
  return `${origin}/a/${tenantSlug}/${agentSlug}`;
}
