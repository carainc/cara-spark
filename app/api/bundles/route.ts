/**
 * GET /api/bundles — the available SIGNED policy bundles for the config selector (tk-0017).
 *
 * Returns display + verification metadata only (version, policyVersion, signedBy, checksum, and the
 * engine-computed checksum/signature validity, plus a red-flag rule summary). It NEVER returns the
 * urgency thresholds or anything mutable: the bundle is the safety contract, and this endpoint is
 * read-only. The verification booleans come from the engine (`verifyPolicyBundle`), so "verified ✓"
 * in the UI is a real recomputation, not a label.
 *
 * Auth: a signed-in console session (Prisma-backed, node runtime). No PHI is involved.
 */
import { auth } from '@/lib/auth';
import { listPolicyBundles } from '@/lib/auth/bundle';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  return Response.json({ bundles: listPolicyBundles() }, { status: 200 });
}
