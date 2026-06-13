import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Auth.js — Google OAuth ONLY (no Cognito, no GitHub — OSS law). Bootstrap super-admin: the
 * account in SUPERADMIN_EMAIL is always promoted to SUPER_ADMIN on sign-in; no hard-coded
 * credentials. Roles super-admin → admin → editor (Lane E / T14 adds invites + the matrix).
 */
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL?.toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  session: { strategy: 'jwt' },
  providers: [Google],
  pages: { signIn: '/login' },
  callbacks: {
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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const uid = token.uid as string | undefined;
        const role = token.role as Role | undefined;
        if (uid) session.user.id = uid;
        session.user.role = role ?? 'EDITOR';
      }
      return session;
    },
  },
});
