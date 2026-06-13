/**
 * Cara data-plane barrel (T5, tk-0005) — the DEFAULT impls behind the provider seam.
 *
 * `createCaraProviders` builds the comms + EHR adapters from env (CARA_API_KEY / CARA_TENANT_ID /
 * CARA_API_BASE_URL). Vendor is config-selectable; defaults match DEFAULT_PROVIDER_CONFIG
 * (comms=cara, ehr=elation). A test (or an alternate transport) can inject `fetchImpl`.
 */

import type { CommsProvider, EhrAdapter, EhrVendor } from '@/lib/providers/types';
import { CaraClient, type FetchLike } from './client';
import { CaraCommsProvider } from './otp';
import { CaraEhrAdapter } from './ehr';

export * from './client';
export { CaraCommsProvider, OtpRateLimitedError } from './otp';
export { CaraEhrAdapter } from './ehr';
export { findPatientByClaim, resolveSinglePatient } from './patient';

export interface CaraProviders {
  comms: CommsProvider;
  ehr: EhrAdapter;
}

/** Build the Cara comms + EHR providers from the environment (one key fronts both). */
export function createCaraProviders(opts?: { ehrVendor?: EhrVendor; fetchImpl?: FetchLike }): CaraProviders {
  const client = CaraClient.fromEnv(undefined, opts?.fetchImpl);
  return {
    comms: new CaraCommsProvider(client, 'cara'),
    ehr: new CaraEhrAdapter(client, opts?.ehrVendor ?? 'elation'),
  };
}
