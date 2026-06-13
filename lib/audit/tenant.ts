/**
 * Resolve the active tenant id for the signed-in user (T11/T12 read-side scoping).
 *
 * The Auth.js session exposes only { id, role } (types/next-auth.d.ts — owned by Lane E). Rather than
 * reach into a session field this lane doesn't own, we resolve tenant from the user row by id. This
 * keeps the audit + resources pages decoupled from the evolving session shape (Lane E / T14) and
 * avoids editing lib/auth.
 *
 * INTEGRATION NOTE (flagged): if Lane E later puts tenantId on the session token, callers can switch
 * to `session.user.tenantId` and drop this query — behavior is identical.
 */
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

/** The user's tenant id, or null (no session / user not yet assigned a tenant). */
export async function getActiveTenantId(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
  return user?.tenantId ?? null;
}
