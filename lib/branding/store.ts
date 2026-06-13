/**
 * Lane D / T15 — branding STORE/RESOLVER. Resolves the effective Theme for a public branded page
 * (`/a/[tenant]/[agentSlug]`) or the console preview. Agent branding overrides tenant branding; both
 * pass through `sanitizeBranding` so nothing unsafe reaches the page.
 *
 * Prisma is injected so this is unit-testable without a live DB. The lookup is read-only.
 */
import type { PrismaClient } from '@prisma/client';
import { sanitizeBranding, type Theme } from './sanitize';

/** Minimal row shapes we read — keeps this decoupled from the full Prisma model. */
export interface TenantBrandingRow {
  name: string;
  brandLogoUrl: string | null;
  brandColor: string | null;
}
export interface AgentBrandingRow {
  name: string;
  slug: string;
  status: string;
  brandLogoUrl: string | null;
  brandColor: string | null;
}

export interface ResolvedBranding {
  theme: Theme;
  agentName: string;
  agentSlug: string;
  published: boolean;
}

/**
 * Merge tenant + agent branding into one sanitized Theme. Agent values win when present; tenant
 * fills the gaps. The agent's `name` is the page display name (sanitized).
 */
export function mergeBranding(tenant: TenantBrandingRow, agent: AgentBrandingRow): ResolvedBranding {
  const theme = sanitizeBranding({
    brandColor: agent.brandColor ?? tenant.brandColor,
    brandLogoUrl: agent.brandLogoUrl ?? tenant.brandLogoUrl,
    displayName: agent.name,
  });
  return {
    theme,
    agentName: agent.name,
    agentSlug: agent.slug,
    published: agent.status === 'PUBLISHED',
  };
}

/**
 * Resolve branding for a public page by tenant slug + agent slug. Returns null when the tenant/agent
 * pair does not exist. (Caller decides whether DRAFT is viewable — the public page requires PUBLISHED;
 * the console preview does not.)
 */
export async function resolveBrandingBySlug(
  prisma: PrismaClient,
  tenantSlug: string,
  agentSlug: string,
): Promise<ResolvedBranding | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true, brandLogoUrl: true, brandColor: true },
  });
  if (!tenant) return null;

  const agent = await prisma.agent.findFirst({
    where: { tenantId: tenant.id, slug: agentSlug },
    select: { name: true, slug: true, status: true, brandLogoUrl: true, brandColor: true },
  });
  if (!agent) return null;

  return mergeBranding(tenant, agent as AgentBrandingRow);
}

/** Resolve branding for the console preview by agent id (scoped to the caller's tenant). */
export async function resolveBrandingByAgentId(
  prisma: PrismaClient,
  agentId: string,
  tenantId: string,
): Promise<ResolvedBranding | null> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
    select: {
      name: true,
      slug: true,
      status: true,
      brandLogoUrl: true,
      brandColor: true,
      tenant: { select: { name: true, brandLogoUrl: true, brandColor: true } },
    },
  });
  if (!agent) return null;
  const tenant = agent.tenant as TenantBrandingRow;
  return mergeBranding(tenant, agent as AgentBrandingRow);
}
