import { describe, it, expect } from 'vitest';
import { findPatientByClaim, resolveSinglePatient } from '@/lib/cara/patient';
import type { EhrAdapter, PatientRef } from '@/lib/providers/types';
import type { IdentityClaim } from '@/lib/identity/types';

const CLAIM: IdentityClaim = { fullName: 'Jane Roe', dateOfBirth: '1990-01-02' };

/** Fake EHR adapter (DI) — asserts the claim is passed through verbatim, returns opaque refs only. */
function fakeEhr(searchResult: PatientRef[]): EhrAdapter {
  return {
    vendor: 'elation',
    async searchPatient(query) {
      expect(query).toEqual({ fullName: CLAIM.fullName, dateOfBirth: CLAIM.dateOfBirth });
      return searchResult;
    },
    async getPatient() {
      return null;
    },
    async writeNote() {
      return { ok: true };
    },
  };
}

describe('cara/patient — the ONLY claim → opaque PatientRef bridge (T5)', () => {
  it('findPatientByClaim passes the claim through and returns opaque refs', async () => {
    const refs = await findPatientByClaim(fakeEhr([{ externalId: 'p_1' }, { externalId: 'p_2' }]), CLAIM);
    expect(refs).toEqual([{ externalId: 'p_1' }, { externalId: 'p_2' }]);
  });

  it('resolveSinglePatient returns the chart only on an unambiguous single match', async () => {
    expect(await resolveSinglePatient(fakeEhr([{ externalId: 'p_1' }]), CLAIM)).toEqual({ externalId: 'p_1' });
  });

  it('fails closed (null) on zero matches', async () => {
    expect(await resolveSinglePatient(fakeEhr([]), CLAIM)).toBeNull();
  });

  it('fails closed (null) on ambiguous (>1) matches', async () => {
    expect(await resolveSinglePatient(fakeEhr([{ externalId: 'a' }, { externalId: 'b' }]), CLAIM)).toBeNull();
  });
});
