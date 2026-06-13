'use server';

/**
 * Server actions for the creator beat (T14 / Lane E). Each action re-derives the session
 * server-side, enforces the role gate, and delegates to the pure-ish service layer in
 * lib/auth/* (which is unit-tested with a mocked Prisma). Auth never touches a triage
 * disposition — it only writes config rows the deterministic engine + voice runtime read.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createInvite } from '@/lib/auth/invites';
import {
  configureChannels,
  createAgent,
  publishAgent,
  setAgentPolicyBundle,
  updateAgentCustomization,
  TOGGLEABLE_CHANNELS,
  type ToggleableChannel,
} from '@/lib/auth/agents';
import type { Role } from '@prisma/client';

async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  return session;
}

/** Create a DRAFT agent on the signed-in user's tenant, then go to its configure page. */
export async function createAgentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tenantId = session.user.tenantId;
  if (!tenantId) throw new Error('Your account is not attached to a tenant yet.');

  const name = String(formData.get('name') ?? '').trim();
  const language = String(formData.get('language') ?? 'EN') === 'ES' ? 'ES' : 'EN';

  const agent = await createAgent(prisma, {
    actorRole: session.user.role,
    tenantId,
    name,
    language,
  });
  revalidatePath('/console/agents');
  redirect(`/console/agents/${agent.id}`);
}

/** Toggle chat/voice/phone on an agent (checkbox presence = enabled). */
export async function configureChannelsAction(agentId: string, formData: FormData): Promise<void> {
  const session = await requireSession();
  const channels: Partial<Record<ToggleableChannel, boolean>> = {};
  for (const kind of TOGGLEABLE_CHANNELS) {
    channels[kind] = formData.get(`channel_${kind}`) != null;
  }
  await configureChannels(prisma, { actorRole: session.user.role, agentId, channels });
  revalidatePath(`/console/agents/${agentId}`);
}

/** Persist channel toggles, then flip the agent to PUBLISHED. */
export async function publishAgentAction(agentId: string, formData: FormData): Promise<void> {
  const session = await requireSession();
  const channels: Partial<Record<ToggleableChannel, boolean>> = {};
  for (const kind of TOGGLEABLE_CHANNELS) {
    channels[kind] = formData.get(`channel_${kind}`) != null;
  }
  await configureChannels(prisma, { actorRole: session.user.role, agentId, channels });
  await publishAgent(prisma, { actorRole: session.user.role, agentId });
  revalidatePath('/console/agents');
  revalidatePath(`/console/agents/${agentId}`);
}

/**
 * Set the agent's signed policy bundle (tk-0017). The service is fail-closed on an unknown version,
 * so a tampered form value can never become the safety contract. Re-derives the session server-side.
 */
export async function setPolicyBundleAction(agentId: string, formData: FormData): Promise<void> {
  const session = await requireSession();
  const policyBundleVersion = String(formData.get('policyBundleVersion') ?? '').trim();
  await setAgentPolicyBundle(prisma, { actorRole: session.user.role, agentId, policyBundleVersion });
  revalidatePath(`/console/agents/${agentId}`);
}

/**
 * Save the agent's TONE/STYLE customization (tk-0015): persona, extra system-prompt text, and
 * additional instructions. Re-derives the session + enforces the role gate. These fields tune the
 * conversational VOICE only — the service appends them after the hard rules under a guardrail, and
 * the deterministic engine still owns every disposition (they can never override it).
 */
export async function updateAgentCustomizationAction(agentId: string, formData: FormData): Promise<void> {
  const session = await requireSession();
  await updateAgentCustomization(prisma, {
    actorRole: session.user.role,
    agentId,
    persona: String(formData.get('persona') ?? ''),
    systemPromptExtra: String(formData.get('systemPromptExtra') ?? ''),
    additionalInstructions: String(formData.get('additionalInstructions') ?? ''),
  });
  revalidatePath(`/console/agents/${agentId}`);
}

/** Mint an invite (admin+ only — the service throws for a non-admin, surfaced as an error). */
export async function createInviteAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tenantId = session.user.tenantId;
  if (!tenantId) throw new Error('Your account is not attached to a tenant yet.');

  const email = String(formData.get('email') ?? '').trim();
  const role = String(formData.get('role') ?? 'EDITOR') as Role;

  await createInvite(prisma, {
    actorRole: session.user.role,
    actorId: session.user.id,
    tenantId,
    email,
    role,
  });
  revalidatePath('/console/agents');
}
