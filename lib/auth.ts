import { cookies } from 'next/headers';
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { tryConsumeInviteByToken } from '@/lib/auth/invites';

/**
 * Auth.js — Google OAuth ONLY (no Cognito, no GitHub — OSS law). Two things happen on sign-in:
 *
 *  1. Bootstrap super-admin: the account in SUPERADMIN_EMAIL is always promoted to SUPER_ADMIN.
 *     No hard-coded credentials — the identity comes from the env var only.
 *  2. Invite ACCEPT: if the visitor arrived via an invite link, the token rode in on the
 *     `spark.invite` cookie (set by /invite/[token]). The `signIn` callback consumes it — the
 *     user is attached to the invited tenant with the invited role, so the 2nd user actually
 *     logs in. A stale/foreign/expired token is ignored (never blocks a legit Google login).
 *
 * Roles: super-admin → admin → editor (see lib/auth/roles.ts). Auth decides who may configure
 * agents + invite — never a triage disposition (the deterministic engine owns those).
 */
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL?.toLowerCase();

/** Cookie carrying a pending invite token from /invite/[token] through the OAuth round-trip. */
export const INVITE_COOKIE = 'spark.invite';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  session: { strategy: 'jwt' },
  providers: [
    // Google verifies emails, so auto-linking a Google sign-in to a seeded/invited email user is safe
    // here — avoids OAuthAccountNotLinked when the super-admin/invitees were seeded by email.
    Google({ allowDangerousEmailAccountLinking: true }),
    // Email + password (no-Google fallback + self-host friendly). The user must already exist with a
    // passwordHash (seeded super-admin/admins); bcrypt-compared. Pure JWT — no adapter session.
    Credentials({
      name: 'Email and password',
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = String(creds?.email ?? '').trim().toLowerCase();
        const password = String(creds?.password ?? '');
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        return ok ? { id: user.id, email: user.email, name: user.name ?? undefined } : null;
      },
    }),
  ],
  pages: { signIn: '/login' },
  callbacks: {
    // Runs after the Google account is linked (PrismaAdapter has created/looked up the User).
    async signIn({ user }) {
      const email = user?.email?.toLowerCase();
      if (!email) return false;
      // Consume a pending invite, if any — attaches this user to the tenant with the invited role.
      try {
        const jar = await cookies();
        const token = jar.get(INVITE_COOKIE)?.value;
        if (token) {
          await tryConsumeInviteByToken(prisma, token, email);
          jar.delete(INVITE_COOKIE);
        }
      } catch {
        // Cookie store unavailable (non-request context) — sign-in proceeds regardless.
      }
      return true;
    },
    async jwt({ token, user }) {
      const email = (user?.email ?? token.email)?.toLowerCase();
      if (!email) return token;
      let dbUser = await prisma.user.findUnique({ where: { email } });
      if (dbUser && SUPERADMIN_EMAIL && email === SUPERADMIN_EMAIL && dbUser.role !== 'SUPER_ADMIN') {
        dbUser = await prisma.user.update({ where: { email }, data: { role: 'SUPER_ADMIN' } });
      }
      if (dbUser) {
        token.uid = dbUser.id;
        token.role = dbUser.role;
        token.tenantId = dbUser.tenantId ?? undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const uid = token.uid as string | undefined;
        const role = token.role as Role | undefined;
        if (uid) session.user.id = uid;
        session.user.role = role ?? 'EDITOR';
        session.user.tenantId = (token.tenantId as string | undefined) ?? null;
      }
      return session;
    },
  },
});
