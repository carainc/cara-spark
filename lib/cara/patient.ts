/**
 * Patient search at the right altitude (T5, tk-0005).
 *
 * This is the ONLY sanctioned bridge from a raw `IdentityClaim` (name + DOB, server-side only) to
 * an OPAQUE `PatientRef`. It exists so callers don't hand-roll EHR queries and accidentally let an
 * identifier escape: input stays server-side, output is opaque, and nothing here is logged.
 *
 * The model NEVER calls this. It runs in a server action / route only.
 */

import type { EhrAdapter, PatientRef } from '@/lib/providers/types';
import type { IdentityClaim } from '@/lib/identity/types';

/** Find candidate charts for a claim. Returns opaque refs only — resolve details server-side. */
export async function findPatientByClaim(ehr: EhrAdapter, claim: IdentityClaim): Promise<PatientRef[]> {
  return ehr.searchPatient({ fullName: claim.fullName, dateOfBirth: claim.dateOfBirth });
}

/**
 * Resolve to a SINGLE unambiguous chart, or null. An unambiguous single match is required before
 * writing back; ambiguity (0 or >1) returns null so the caller fails closed rather than guessing.
 */
export async function resolveSinglePatient(ehr: EhrAdapter, claim: IdentityClaim): Promise<PatientRef | null> {
  const hits = await findPatientByClaim(ehr, claim);
  return hits.length === 1 ? hits[0] : null;
}
