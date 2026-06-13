/**
 * Creator-facing config constants (T14 / Lane E). Two demo-visible pins from the config/admin
 * gap audit live here:
 *
 *  1. Policy-bundle selector ships as tk-0017 (GET /api/bundles + a dropdown writing
 *     Agent.policyBundleVersion). Until then every agent defaults to the signed DEFAULT bundle
 *     and the form shows "vN · verified ✓". `agentForm.tsx` leaves a disabled hook for tk-0017.
 *
 *  2. The PHONE channel shows the configured DID READ-ONLY — never an empty field. The demo uses
 *     the +14157180498 fallback rung. The value is sourced from DEMO_PHONE_DID so the prod number
 *     is never the only source and is never WRITTEN by this app (prod voice isolation, AGENTS §7).
 */

/** The signed DEFAULT policy bundle version (mirrors db/seed.ts + the engine's default bundle). */
export const DEFAULT_POLICY_BUNDLE_VERSION = 'default-0.1.0';

/** Human label for the (currently fixed) bundle selection — the "verified" badge the demo shows. */
export function bundleVerifiedLabel(version: string = DEFAULT_POLICY_BUNDLE_VERSION): string {
  return `${version} · verified ✓`;
}

/**
 * The read-only DID shown when PHONE is enabled. Falls back to the documented demo rung so the
 * field is never empty. NOTE: display only — Cara Spark never buys/writes a per-agent number, and
 * never touches the prod Telnyx trunk; Lane G owns the standalone voice resources.
 */
export function demoPhoneDid(): string {
  return process.env.DEMO_PHONE_DID?.trim() || '+14157180498';
}
