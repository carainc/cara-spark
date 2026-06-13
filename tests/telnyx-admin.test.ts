/**
 * Admin provisioning service (tk-0024) — guarded search + an approval-request flow that NEVER buys.
 *
 *   • searchNumbers + requestProvisioning require ADMIN (an EDITOR is rejected).
 *   • searchNumbers delegates to the provisioner's read-only search.
 *   • requestProvisioning returns a structured `requires_approval` request and NEVER calls
 *     orderNumber on the provisioner (the human gate is intact; nothing auto-buys).
 *
 * The provisioner is a tiny spy so we can prove orderNumber is never reached.
 */
import { describe, it, expect, vi } from 'vitest';
import { AdminProvisioningService } from '@/lib/telnyx/admin';
import type { NumberProvisioner, AvailableNumber, OrderResult } from '@/lib/telnyx/provisioning';

function makeSpyProvisioner(numbers: AvailableNumber[] = []): {
  provisioner: NumberProvisioner;
  searchAvailable: ReturnType<typeof vi.fn>;
  orderNumber: ReturnType<typeof vi.fn>;
} {
  const searchAvailable = vi.fn(async () => numbers);
  const orderNumber = vi.fn(
    async (): Promise<OrderResult> => ({
      status: 'requires_approval',
      reason: 'gate_closed',
      candidate: { phoneNumber: '+10000000000' },
    }),
  );
  const provisioner: NumberProvisioner = { vendor: 'telnyx', searchAvailable, orderNumber };
  return { provisioner, searchAvailable, orderNumber };
}

const NUMBERS: AvailableNumber[] = [
  { phoneNumber: '+14155550123', region: 'San Francisco', monthlyCost: '1.00', currency: 'USD' },
];

describe('AdminProvisioningService — role gate', () => {
  it('rejects an EDITOR from searching (provisioning is ADMIN+)', async () => {
    const { provisioner, searchAvailable } = makeSpyProvisioner(NUMBERS);
    const svc = new AdminProvisioningService({ provisioner });
    await expect(svc.searchNumbers({ actorRole: 'EDITOR', spec: { areaCode: '415' } })).rejects.toThrow(
      /admin role/i,
    );
    expect(searchAvailable).not.toHaveBeenCalled();
  });

  it('rejects an EDITOR from requesting provisioning', async () => {
    const { provisioner, orderNumber } = makeSpyProvisioner();
    const svc = new AdminProvisioningService({ provisioner });
    await expect(
      svc.requestProvisioning({ actorRole: 'EDITOR', actorId: 'u1', candidate: { phoneNumber: '+14155550123' } }),
    ).rejects.toThrow(/admin role/i);
    expect(orderNumber).not.toHaveBeenCalled();
  });
});

describe('AdminProvisioningService — search (dry-run)', () => {
  it('an ADMIN gets the provisioner search results', async () => {
    const { provisioner, searchAvailable } = makeSpyProvisioner(NUMBERS);
    const svc = new AdminProvisioningService({ provisioner });
    const out = await svc.searchNumbers({ actorRole: 'ADMIN', spec: { areaCode: '415', limit: 3 } });
    expect(out).toEqual(NUMBERS);
    expect(searchAvailable).toHaveBeenCalledWith({ areaCode: '415', limit: 3 });
  });
});

describe('AdminProvisioningService — requestProvisioning never buys', () => {
  it('returns a deterministic requires_approval request and NEVER calls orderNumber', async () => {
    const { provisioner, orderNumber } = makeSpyProvisioner();
    const svc = new AdminProvisioningService({
      provisioner,
      now: () => new Date('2026-06-13T00:00:00.000Z'),
      nonce: () => 'abc12345',
    });

    const req = await svc.requestProvisioning({
      actorRole: 'ADMIN',
      actorId: 'user-1',
      candidate: { phoneNumber: '+14155550123' },
      estimatedCost: { monthlyCost: '1.00', currency: 'USD' },
    });

    expect(req.status).toBe('requires_approval');
    expect(req.requestId).toBe('prov-abc12345');
    expect(req.candidate).toEqual({ phoneNumber: '+14155550123' });
    expect(req.estimatedCost).toEqual({ monthlyCost: '1.00', currency: 'USD' });
    expect(req.requestedBy).toBe('user-1');
    expect(req.requestedAt).toBe('2026-06-13T00:00:00.000Z');
    expect(req.note).toMatch(/human gate/i);
    // THE critical assertion: raising an approval request must NEVER place an order.
    expect(orderNumber).not.toHaveBeenCalled();
  });

  it('rejects a blank candidate phoneNumber', async () => {
    const { provisioner } = makeSpyProvisioner();
    const svc = new AdminProvisioningService({ provisioner });
    await expect(
      svc.requestProvisioning({ actorRole: 'ADMIN', actorId: 'u1', candidate: { phoneNumber: '  ' } }),
    ).rejects.toThrow(/phoneNumber is required/i);
  });
});
