/**
 * POST /api/admin/numbers — the admin DID-provisioning surface (tk-0024).
 *
 * Two safe actions (selected by `body.action`):
 *   • "search"  → DRY-RUN list of available numbers (read-only; never spends).
 *   • "request" → raises an APPROVAL REQUEST for a human to action. NEVER auto-buys.
 *
 * Buying a number is a human gate (the runbook) — this route deliberately exposes NO "buy" action.
 * The only path that can place a real order is the provisioner's gated `orderNumber`, which needs
 * both an explicit confirmedSpend AND the ALLOW_TELNYX_PROVISIONING deploy flag, and is reached
 * only from the documented runbook step — not from any request this route serves.
 *
 * Guarded: ADMIN+ only (provisioning is a money action). No PHI here — DIDs are not patient data.
 * Node runtime (Prisma-safe; provisioner reads env).
 */
import { auth } from '@/lib/auth';
import { atLeast } from '@/lib/auth/roles';
import { getNumberProvisioner, AdminProvisioningService, TelnyxConfigError } from '@/lib/telnyx';

export const runtime = 'nodejs';

interface SearchBody {
  action: 'search';
  areaCode?: string;
  region?: string;
  limit?: number;
}
interface RequestBody {
  action: 'request';
  phoneNumber: string;
  estimatedCost?: { monthlyCost?: string; currency?: string };
}
type Body = SearchBody | RequestBody;

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  // Admin-gated: provisioning spends money, so it sits above the editor floor.
  if (!session?.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!atLeast(session.user.role, 'ADMIN')) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Construct the provisioner from env. Missing key → a clean "needs TELNYX_API_KEY" gate (502),
  // never a stack trace and never the key value.
  let service: AdminProvisioningService;
  try {
    service = new AdminProvisioningService({ provisioner: getNumberProvisioner() });
  } catch (err) {
    if (err instanceof TelnyxConfigError) {
      return Response.json({ ok: false, error: err.message }, { status: 502 });
    }
    throw err;
  }

  const role = session.user.role;
  const actorId = session.user.id;

  if (body?.action === 'search') {
    const numbers = await service.searchNumbers({
      actorRole: role,
      spec: { areaCode: body.areaCode, region: body.region, limit: body.limit },
    });
    return Response.json({ ok: true, numbers }, { status: 200 });
  }

  if (body?.action === 'request') {
    if (!body.phoneNumber) {
      return Response.json({ ok: false, error: 'phoneNumber is required' }, { status: 400 });
    }
    const request = await service.requestProvisioning({
      actorRole: role,
      actorId,
      candidate: { phoneNumber: body.phoneNumber },
      estimatedCost: body.estimatedCost,
    });
    // 202 Accepted: a human still has to approve the spend — nothing was bought.
    return Response.json({ ok: true, request }, { status: 202 });
  }

  return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
