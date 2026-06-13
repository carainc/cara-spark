/**
 * Provider registry (T5, tk-0005) — selects the comms + EHR impls at boot from CONFIG, not code.
 *
 * Cara is the default (one key + the Cara number / the Cara EHR proxy). Adding SendGrid/Twilio or
 * another EHR is registering a factory here + flipping ProviderConfig — the FROZEN seam
 * (./types) stays untouched, so callers never change.
 *
 * Today only the Cara factories are wired (the demo's default). Other vendors throw a clear
 * "not wired" error rather than silently mis-routing.
 */

import {
  type CommsProvider,
  type CommsVendor,
  type EhrAdapter,
  type EhrVendor,
  type ProviderConfig,
  DEFAULT_PROVIDER_CONFIG,
} from './types';
import { createCaraProviders, type CaraProviders } from '@/lib/cara';
import { createIdentityVerifier } from '@/lib/identity';
import type { IdentityVerifier } from '@/lib/identity/types';
import type { FetchLike } from '@/lib/cara/client';

export type { ProviderConfig } from './types';

/** Read the active provider config from env (falls back to the Cara default). */
export function providerConfigFromEnv(env: Record<string, string | undefined> = process.env): ProviderConfig {
  const comms = (env.COMMS_VENDOR as CommsVendor) || DEFAULT_PROVIDER_CONFIG.comms;
  const ehr = (env.EHR_VENDOR as EhrVendor) || DEFAULT_PROVIDER_CONFIG.ehr;
  return { comms, ehr };
}

export interface Providers {
  comms: CommsProvider;
  ehr: EhrAdapter;
  identity: IdentityVerifier;
}

/**
 * Resolve the configured providers. `fetchImpl` is injectable so the whole stack can be tested
 * MOCKED end-to-end. Non-Cara vendors are not yet wired (config-add, not in T5 scope).
 */
export function getProviders(
  config: ProviderConfig = providerConfigFromEnv(),
  opts?: { fetchImpl?: FetchLike },
): Providers {
  let base: CaraProviders;

  // Comms selection (Cara default). The EHR vendor rides the same Cara client when comms=cara.
  switch (config.comms) {
    case 'cara':
      base = createCaraProviders({ ehrVendor: config.ehr, fetchImpl: opts?.fetchImpl });
      break;
    case 'twilio':
    case 'sendgrid':
      throw new Error(
        `Comms vendor "${config.comms}" is not wired yet — register a factory in lib/providers/index.ts (config-add, FROZEN seam unchanged).`,
      );
    default:
      throw new Error(`Unknown comms vendor: ${String(config.comms)}`);
  }

  return {
    comms: base.comms,
    ehr: base.ehr,
    identity: createIdentityVerifier(base.comms),
  };
}
