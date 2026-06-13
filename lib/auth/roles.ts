/**
 * Role hierarchy + capability checks (T14 / Lane E). Pure — no DB, no env, no I/O — so the
 * rules are unit-testable in isolation and reused by both server actions and the auth callback.
 *
 * super-admin → admin → editor. Higher rank strictly includes every capability of the lower.
 * The deterministic ENGINE owns triage dispositions; AUTH only owns who may configure agents
 * and invite teammates. Auth never touches a disposition.
 */
import type { Role } from '@prisma/client';

/** Strict rank — a larger number outranks a smaller one. */
export const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 3,
  ADMIN: 2,
  EDITOR: 1,
};

/** True when `role` is at least as privileged as `min`. */
export function atLeast(role: Role | undefined | null, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Only admins and super-admins may create invites. A non-admin (EDITOR) cannot invite. */
export function canInvite(role: Role | undefined | null): boolean {
  return atLeast(role, 'ADMIN');
}

/**
 * Editors and up may create/configure/publish agents (the creator beat). Editor is the
 * floor: a signed-in console user is at minimum an EDITOR.
 */
export function canManageAgents(role: Role | undefined | null): boolean {
  return atLeast(role, 'EDITOR');
}

/**
 * Roles a given actor is allowed to GRANT on an invite. An actor who cannot invite at all (an
 * EDITOR) grants nothing. Otherwise you can never invite above your own rank: an admin may mint
 * ADMIN/EDITOR invites; a super-admin may mint any. This keeps privilege from escalating through
 * the invite path.
 */
export function grantableRoles(actor: Role | undefined | null): Role[] {
  if (!canInvite(actor)) return [];
  return (Object.keys(ROLE_RANK) as Role[]).filter((r) => ROLE_RANK[r] <= ROLE_RANK[actor!]);
}

/** True when `actor` may mint an invite carrying `target` role. */
export function canGrantRole(actor: Role | undefined | null, target: Role): boolean {
  if (!canInvite(actor)) return false;
  return grantableRoles(actor).includes(target);
}
