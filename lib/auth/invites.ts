/**
 * Invite create + ACCEPT (T14 / Lane E — the Setup demo beat). A seeded admin mints an Invite
 * (token + expiry, scoped to a tenant + role); a second person follows the token link, signs in
 * with Google, and the auth `signIn` callback calls `consumeInvite` to attach them to the tenant
 * with the invited role. "They invite the rest" means the second user actually logs in.
 *
 * No hard-coded creds. No PHI. The functions take an injected Prisma-like client so they are
 * unit-testable with a mock (no network, OSS testing law).
 */
import { randomBytes } from 'node:crypto';
import type { Role } from '@prisma/client';
import { canGrantRole } from './roles';

/** Default invite lifetime — 7 days. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Narrow structural slice of PrismaClient — only the calls these services make. The arg types are
 * intentionally loose (`any`) so BOTH the real `PrismaClient` AND a hand-rolled test mock satisfy
 * the interface (Prisma's generated arg types are too specific to widen otherwise). Return types
 * stay strict, so call sites are still type-checked on what they read back.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface InvitePrisma {
  invite: {
    create(args: { data: any }): Promise<InviteRow>;
    findUnique(args: { where: any }): Promise<InviteRow | null>;
    update(args: { where: any; data: any }): Promise<InviteRow>;
  };
  user: {
    update(args: { where: any; data: any }): Promise<UserRow>;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface InviteRow {
  id: string;
  email: string;
  role: Role;
  tenantId: string;
  invitedById: string | null;
  token: string;
  acceptedAt: Date | null;
  expiresAt: Date;
}

export interface UserRow {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
}

export interface CreateInviteInput {
  /** Role of the actor minting the invite — gates the whole operation. */
  actorRole: Role | undefined | null;
  actorId: string;
  tenantId: string;
  email: string;
  /** Role to grant the invitee (defaults to EDITOR). */
  role?: Role;
  now?: Date;
}

/** A cryptographically-random, URL-safe invite token. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Create an invite. Throws if the actor is not an admin+ (a non-admin CANNOT invite) or if they
 * try to grant a role above their own rank. Email is normalized to lower-case so accept matches.
 */
export async function createInvite(db: InvitePrisma, input: CreateInviteInput): Promise<InviteRow> {
  const role = input.role ?? 'EDITOR';
  if (!canGrantRole(input.actorRole, role)) {
    throw new Error('Forbidden: only an admin or super-admin may invite, and never above their own role.');
  }
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('A valid email is required to invite.');

  const now = input.now ?? new Date();
  return db.invite.create({
    data: {
      email,
      role,
      tenantId: input.tenantId,
      invitedById: input.actorId,
      token: generateInviteToken(),
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    },
  });
}

export interface ConsumeInviteResult {
  user: UserRow;
  invite: InviteRow;
}

/**
 * Consume an invite by token on sign-in: validate (exists, not expired, not already accepted,
 * email matches the signed-in account), then attach the user to the tenant with the invited
 * role and stamp `acceptedAt`. Returns the updated user. Throws on any invalid/expired token.
 *
 * Idempotency: a token already accepted throws — the link is single-use.
 */
export async function consumeInvite(
  db: InvitePrisma,
  token: string,
  signedInEmail: string,
  now: Date = new Date(),
): Promise<ConsumeInviteResult> {
  const invite = await db.invite.findUnique({ where: { token } });
  if (!invite) throw new Error('Invalid invite token.');
  if (invite.acceptedAt) throw new Error('This invite has already been used.');
  if (invite.expiresAt.getTime() <= now.getTime()) throw new Error('This invite has expired.');

  const email = signedInEmail.trim().toLowerCase();
  if (email !== invite.email.toLowerCase()) {
    throw new Error('This invite was issued to a different email address.');
  }

  // Attach the user to the tenant with the invited role — this is what makes the 2nd user a
  // real member who can log in to the console.
  const user = await db.user.update({
    where: { email },
    data: { tenantId: invite.tenantId, role: invite.role },
  });
  const accepted = await db.invite.update({ where: { id: invite.id }, data: { acceptedAt: now } });
  return { user, invite: accepted };
}

/**
 * Try to consume the single pending invite for a freshly signed-in user (used by the auth
 * callback when no explicit token is in hand — e.g. the user clicked the link, signed in, and
 * the token rode through the OAuth `state`/cookie). Best-effort: never throws, returns the
 * updated user or null so sign-in is not blocked when there's simply nothing to accept.
 */
export async function tryConsumeInviteByToken(
  db: InvitePrisma,
  token: string | undefined,
  signedInEmail: string,
  now: Date = new Date(),
): Promise<UserRow | null> {
  if (!token) return null;
  try {
    const { user } = await consumeInvite(db, token, signedInEmail, now);
    return user;
  } catch {
    // A stale/foreign/expired token must not lock a legitimate Google account out of sign-in.
    return null;
  }
}
