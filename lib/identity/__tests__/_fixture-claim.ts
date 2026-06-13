/**
 * SYNTHETIC, invented identity claim for tests. NOT a real person — no real PHI.
 * Used to prove (via grep) that none of these identifiers ever reach model context.
 */
import type { IdentityClaim } from '@/lib/identity/types';

export const FIXTURE_CLAIM: IdentityClaim = {
  fullName: 'Wendeline Quackenbush',
  dateOfBirth: '1987-03-14',
  phone: '+15555550199',
  email: 'wendeline.q@example.test',
};

/** The distinct identifier strings that MUST be absent from any model-bound payload. */
export const FIXTURE_IDENTIFIERS: string[] = [
  FIXTURE_CLAIM.fullName,
  'Wendeline',
  'Quackenbush',
  FIXTURE_CLAIM.dateOfBirth,
  FIXTURE_CLAIM.phone!,
  FIXTURE_CLAIM.email!,
];
