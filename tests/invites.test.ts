import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInvite,
  consumeInvite,
  tryConsumeInviteByToken,
  type InvitePrisma,
  type InviteRow,
  type UserRow,
} from '@/lib/auth/invites';
import type { Role } from '@prisma/client';

/**
 * In-memory Prisma double — NO network, NO real DB (OSS testing law). Captures only the slice the
 * invite service touches. Mirrors the schema's @@unique([tenantId, email]) loosely enough to test
 * the create + accept flow end-to-end.
 */
function makeDb(seedUsers: UserRow[] = []) {
  const invites: InviteRow[] = [];
  const users: UserRow[] = [...seedUsers];
  let seq = 0;

  const db: InvitePrisma = {
    invite: {
      async create({ data }) {
        const row: InviteRow = {
          id: `inv_${++seq}`,
          email: data.email as string,
          role: data.role as Role,
          tenantId: data.tenantId as string,
          invitedById: (data.invitedById as string) ?? null,
          token: data.token as string,
          acceptedAt: null,
          expiresAt: data.expiresAt as Date,
        };
        invites.push(row);
        return row;
      },
      async findUnique({ where }) {
        return invites.find((i) => i.token === where.token) ?? null;
      },
      async update({ where, data }) {
        const row = invites.find((i) => i.id === where.id);
        if (!row) throw new Error('invite not found');
        Object.assign(row, data);
        return row;
      },
    },
    user: {
      async update({ where, data }) {
        const row = users.find((u) => u.email === where.email);
        if (!row) throw new Error('user not found');
        Object.assign(row, data);
        return row;
      },
    },
  };
  return { db, invites, users };
}

const TENANT = 'tenant_demo';

describe('invite create — only an admin+ can invite', () => {
  let store: ReturnType<typeof makeDb>;
  beforeEach(() => {
    store = makeDb();
  });

  it('an admin creates an invite (token + future expiry)', async () => {
    const invite = await createInvite(store.db, {
      actorRole: 'ADMIN',
      actorId: 'admin_1',
      tenantId: TENANT,
      email: 'NewPerson@Example.org',
      role: 'EDITOR',
    });
    expect(invite.token).toBeTruthy();
    expect(invite.email).toBe('newperson@example.org'); // normalized
    expect(invite.tenantId).toBe(TENANT);
    expect(invite.role).toBe('EDITOR');
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(store.invites).toHaveLength(1);
  });

  it('a non-admin (EDITOR) CANNOT invite', async () => {
    await expect(
      createInvite(store.db, {
        actorRole: 'EDITOR',
        actorId: 'editor_1',
        tenantId: TENANT,
        email: 'someone@example.org',
      }),
    ).rejects.toThrow(/only an admin/i);
    expect(store.invites).toHaveLength(0);
  });

  it('cannot grant a role above the actor (admin → SUPER_ADMIN is rejected)', async () => {
    await expect(
      createInvite(store.db, {
        actorRole: 'ADMIN',
        actorId: 'admin_1',
        tenantId: TENANT,
        email: 'someone@example.org',
        role: 'SUPER_ADMIN',
      }),
    ).rejects.toThrow();
    expect(store.invites).toHaveLength(0);
  });
});

describe('invite ACCEPT — the second user actually logs in', () => {
  it('a second user accepts → attached to the tenant with the invited role', async () => {
    // The invitee already exists as a User row (PrismaAdapter creates it on first Google sign-in),
    // not yet attached to a tenant.
    const store = makeDb([{ id: 'user_2', email: 'colleague@example.org', role: 'EDITOR', tenantId: null }]);
    const invite = await createInvite(store.db, {
      actorRole: 'ADMIN',
      actorId: 'admin_1',
      tenantId: TENANT,
      email: 'colleague@example.org',
      role: 'ADMIN',
    });

    const { user, invite: accepted } = await consumeInvite(store.db, invite.token, 'colleague@example.org');

    // Attached to the tenant with the invited role — this user can now log in to the console.
    expect(user.tenantId).toBe(TENANT);
    expect(user.role).toBe('ADMIN');
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
  });

  it('email mismatch is rejected (invite issued to a different address)', async () => {
    const store = makeDb([{ id: 'user_x', email: 'wrong@example.org', role: 'EDITOR', tenantId: null }]);
    const invite = await createInvite(store.db, {
      actorRole: 'ADMIN',
      actorId: 'admin_1',
      tenantId: TENANT,
      email: 'right@example.org',
    });
    await expect(consumeInvite(store.db, invite.token, 'wrong@example.org')).rejects.toThrow(
      /different email/i,
    );
  });

  it('an expired invite is rejected', async () => {
    const store = makeDb([{ id: 'user_2', email: 'late@example.org', role: 'EDITOR', tenantId: null }]);
    const past = new Date(Date.now() - 60_000);
    const invite = await createInvite(store.db, {
      actorRole: 'ADMIN',
      actorId: 'admin_1',
      tenantId: TENANT,
      email: 'late@example.org',
      now: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // created 8 days ago → already expired
    });
    expect(invite.expiresAt.getTime()).toBeLessThan(Date.now());
    await expect(consumeInvite(store.db, invite.token, 'late@example.org', new Date())).rejects.toThrow(
      /expired/i,
    );
    void past;
  });

  it('a token is single-use (already accepted → rejected)', async () => {
    const store = makeDb([{ id: 'user_2', email: 'once@example.org', role: 'EDITOR', tenantId: null }]);
    const invite = await createInvite(store.db, {
      actorRole: 'ADMIN',
      actorId: 'admin_1',
      tenantId: TENANT,
      email: 'once@example.org',
    });
    await consumeInvite(store.db, invite.token, 'once@example.org');
    await expect(consumeInvite(store.db, invite.token, 'once@example.org')).rejects.toThrow(
      /already been used/i,
    );
  });

  it('tryConsumeInviteByToken never throws on a bad token (sign-in is not blocked)', async () => {
    const store = makeDb([{ id: 'user_2', email: 'safe@example.org', role: 'EDITOR', tenantId: null }]);
    // No invite with this token exists.
    const result = await tryConsumeInviteByToken(store.db, 'nonexistent-token', 'safe@example.org');
    expect(result).toBeNull();
    // And an undefined token (user signed in normally, no invite) is a no-op.
    expect(await tryConsumeInviteByToken(store.db, undefined, 'safe@example.org')).toBeNull();
  });
});
