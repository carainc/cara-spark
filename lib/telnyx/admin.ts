/**
 * Admin provisioning service (tk-0024) — the guarded, role-checked surface the console/API calls.
 *
 * Two operations, both SAFE-by-default:
 *   • searchNumbers       — a DRY-RUN search of available DIDs (read-only; never spends).
 *   • requestProvisioning — records an APPROVAL REQUEST for a human to action. It NEVER auto-buys.
 *                           Ordering a number is a human gate (the runbook): this returns a
 *                           structured `requires_approval` request describing the candidate +
 *                           estimated cost. A separate, explicitly-confirmed step (with the deploy
 *                           flag set) is what actually places an order — and that lives in the
 *                           provisioner, gated.
 *
 * Why no DB write here: `db/schema.prisma` is a FROZEN contract with no ProvisioningRequest model,
 * and adding one is a coordinated edit (logged in RUN_STATE.md), not a silent in-ticket change. So
 * the approval request is a structured RETURN value the caller surfaces / routes to a human — the
 * seam is real and the human gate is intact without touching the frozen schema.
 *
 * Guarded like the rest of the admin surface (lib/auth/agents.ts): provisioning is a MONEY action,
 * so it requires ADMIN (canInvite) — strictly above the EDITOR floor that may toggle channels.
 */
import type { Role } from '@prisma/client';
import { canInvite } from '@/lib/auth/roles';
import type {
  AvailableNumber,
  NumberProvisioner,
  OrderSpec,
  SearchSpec,
} from './provisioning';

/** A human-actionable approval request. NOT persisted (frozen schema) — surfaced to the caller. */
export interface ProvisioningApprovalRequest {
  status: 'requires_approval';
  /** Stable, non-secret request id (caller may log / show it). Derived from the inputs + a nonce. */
  requestId: string;
  candidate: OrderSpec;
  /** Best-effort estimated monthly cost from the search, for the human approving the spend. */
  estimatedCost?: { monthlyCost?: string; currency?: string };
  /** Opaque ref of the requesting actor (id only — no PII). */
  requestedBy: string;
  /** ISO timestamp the request was raised. */
  requestedAt: string;
  /** Plain-English next step for the human (the runbook gate). */
  note: string;
}

const APPROVAL_NOTE =
  'Provisioning a DID spends money and is a human gate. To proceed, an operator must run the ' +
  'documented runbook with ALLOW_TELNYX_PROVISIONING set and an explicit confirmedSpend — the ' +
  'app will not auto-buy.';

export interface AdminProvisioningDeps {
  provisioner: NumberProvisioner;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Injectable id source for deterministic tests. */
  nonce?: () => string;
}

export interface SearchInput {
  actorRole: Role | undefined | null;
  spec: SearchSpec;
}

export interface RequestProvisioningInput {
  actorRole: Role | undefined | null;
  /** Opaque actor id — never a name/email. */
  actorId: string;
  candidate: OrderSpec;
  /** Optional estimate carried from a prior search to show the approver. */
  estimatedCost?: { monthlyCost?: string; currency?: string };
}

/**
 * The admin provisioning service. Construct with an injected provisioner (real Telnyx in prod, a
 * mock in tests) so nothing here ever hits a live network or spends on its own.
 */
export class AdminProvisioningService {
  private readonly provisioner: NumberProvisioner;
  private readonly now: () => Date;
  private readonly nonce: () => string;

  constructor(deps: AdminProvisioningDeps) {
    this.provisioner = deps.provisioner;
    this.now = deps.now ?? (() => new Date());
    this.nonce = deps.nonce ?? (() => Math.random().toString(36).slice(2, 10));
  }

  /** DRY-RUN search of available numbers. Guarded by ADMIN. Read-only — never spends. */
  async searchNumbers(input: SearchInput): Promise<AvailableNumber[]> {
    if (!canInvite(input.actorRole)) {
      throw new Error('Forbidden: provisioning requires an admin role.');
    }
    return this.provisioner.searchAvailable(input.spec);
  }

  /**
   * Record an approval request for a human to action. NEVER places an order. Guarded by ADMIN.
   *
   * This deliberately does NOT call `provisioner.orderNumber` — even the gated order path stays
   * untouched from the admin surface. The only thing that can buy is the runbook step.
   */
  async requestProvisioning(input: RequestProvisioningInput): Promise<ProvisioningApprovalRequest> {
    if (!canInvite(input.actorRole)) {
      throw new Error('Forbidden: provisioning requires an admin role.');
    }
    const phone = input.candidate.phoneNumber?.trim();
    if (!phone) throw new Error('A candidate phoneNumber is required to request provisioning.');

    return {
      status: 'requires_approval',
      requestId: `prov-${this.nonce()}`,
      candidate: { phoneNumber: phone },
      estimatedCost: input.estimatedCost,
      requestedBy: input.actorId,
      requestedAt: this.now().toISOString(),
      note: APPROVAL_NOTE,
    };
  }
}
