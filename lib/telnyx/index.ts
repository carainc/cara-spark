/**
 * Telnyx module barrel (tk-0024) — the vendor-agnostic DID provisioning seam + the Telnyx impl,
 * behind a HARD spend gate. Import from here:
 *   import { getNumberProvisioner, assignNumberToAgent, AdminProvisioningService } from '@/lib/telnyx';
 *
 * SAFETY: nothing here spends by default. `orderNumber` is gated on confirmedSpend + the
 * ALLOW_TELNYX_PROVISIONING env flag; the admin surface only searches + raises approval requests.
 */
export * from './provisioning';
export * from './admin';

import { TelnyxNumberProvisioner, type FetchLike, type NumberProvisioner } from './provisioning';

/**
 * Resolve the configured number provisioner. `fetchImpl` is injectable so the whole flow can be
 * tested MOCKED. Today only Telnyx is wired; the key is read from env (TELNYX_API_KEY) and absence
 * surfaces a clear TelnyxConfigError (the caller turns that into a "needs key" gate). This NEVER
 * spends on construction — only a fully-gated, explicitly-confirmed `orderNumber` can.
 */
export function getNumberProvisioner(opts?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}): NumberProvisioner {
  return TelnyxNumberProvisioner.fromEnv(opts?.env, opts?.fetchImpl);
}
