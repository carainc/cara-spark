import { describe, it, expect } from 'vitest';
import {
  atLeast,
  canInvite,
  canManageAgents,
  canGrantRole,
  grantableRoles,
  ROLE_RANK,
} from '@/lib/auth/roles';

describe('role hierarchy super-admin → admin → editor', () => {
  it('ranks strictly', () => {
    expect(ROLE_RANK.SUPER_ADMIN).toBeGreaterThan(ROLE_RANK.ADMIN);
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.EDITOR);
  });

  it('atLeast includes equal and higher ranks', () => {
    expect(atLeast('SUPER_ADMIN', 'ADMIN')).toBe(true);
    expect(atLeast('ADMIN', 'ADMIN')).toBe(true);
    expect(atLeast('EDITOR', 'ADMIN')).toBe(false);
    expect(atLeast(undefined, 'EDITOR')).toBe(false);
    expect(atLeast(null, 'EDITOR')).toBe(false);
  });
});

describe('invite capability — a non-admin cannot invite', () => {
  it('admins and super-admins can invite; editors cannot', () => {
    expect(canInvite('SUPER_ADMIN')).toBe(true);
    expect(canInvite('ADMIN')).toBe(true);
    expect(canInvite('EDITOR')).toBe(false);
    expect(canInvite(undefined)).toBe(false);
  });
});

describe('agent management capability', () => {
  it('editor and up may manage agents', () => {
    expect(canManageAgents('EDITOR')).toBe(true);
    expect(canManageAgents('ADMIN')).toBe(true);
    expect(canManageAgents('SUPER_ADMIN')).toBe(true);
    expect(canManageAgents(undefined)).toBe(false);
  });
});

describe('no privilege escalation through invites', () => {
  it('an admin can grant ADMIN/EDITOR but not SUPER_ADMIN', () => {
    expect(grantableRoles('ADMIN').sort()).toEqual(['ADMIN', 'EDITOR']);
    expect(canGrantRole('ADMIN', 'EDITOR')).toBe(true);
    expect(canGrantRole('ADMIN', 'ADMIN')).toBe(true);
    expect(canGrantRole('ADMIN', 'SUPER_ADMIN')).toBe(false);
  });

  it('a super-admin can grant any role', () => {
    expect(grantableRoles('SUPER_ADMIN').sort()).toEqual(['ADMIN', 'EDITOR', 'SUPER_ADMIN']);
    expect(canGrantRole('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
  });

  it('an editor can grant nothing', () => {
    expect(grantableRoles('EDITOR')).toEqual([]);
    expect(canGrantRole('EDITOR', 'EDITOR')).toBe(false);
  });
});
