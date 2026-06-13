import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { signIn, INVITE_COOKIE } from '@/lib/auth';

/**
 * Invite ACCEPT landing (T14 / Lane E — the Setup demo beat). A teammate opens the token link,
 * sees who invited them + the role, and continues with Google. On submit we stash the token in a
 * short-lived cookie and kick off Google sign-in; the auth `signIn` callback then consumes the
 * invite (attaches the user to the tenant with the invited role). "They invite the rest" — and
 * the second user actually logs in.
 *
 * This page only READS the invite to render a friendly preview. The authoritative validate +
 * consume happens server-side in lib/auth/invites.ts during the OAuth round-trip.
 */
export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { tenant: true, invitedBy: true },
  });

  const valid =
    invite && !invite.acceptedAt && invite.expiresAt.getTime() > Date.now();

  async function accept() {
    'use server';
    // Stash the token so the sign-in callback can consume it after Google returns.
    const jar = await cookies();
    jar.set(INVITE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 15, // 15 min — just long enough for the OAuth round-trip.
    });
    await signIn('google', { redirectTo: '/console/agents' });
  }

  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">You&apos;re invited</h1>
      {!valid ? (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          This invite link is invalid, already used, or expired. Ask your admin to send a new one.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-gray-600">
            {invite.invitedBy?.name ?? invite.invitedBy?.email ?? 'An admin'} invited{' '}
            <span className="font-medium">{invite.email}</span> to join{' '}
            <span className="font-medium">{invite.tenant.name}</span> as{' '}
            <span className="font-medium">{invite.role}</span>.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Sign in with the Google account for {invite.email} to accept.
          </p>
          <form action={accept} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-md border border-gray-300 px-4 py-2 font-medium hover:bg-gray-50"
            >
              Continue with Google
            </button>
          </form>
        </>
      )}
    </section>
  );
}
