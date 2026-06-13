/**
 * Creator-facing config constants (T14 / Lane E). Two demo-visible pins from the config/admin
 * gap audit live here:
 *
 *  1. Policy-bundle selector (tk-0017, now wired in the tabbed config — tk-0022): GET /api/bundles
 *     lists the available SIGNED bundles, and a selector writes Agent.policyBundleVersion. Every
 *     agent defaults to the signed DEFAULT bundle; the form shows "vN · verified ✓".
 *
 *  2. The PHONE channel shows the configured DID READ-ONLY — never an empty field. The demo uses
 *     the +14157180498 fallback rung. The value is sourced from DEMO_PHONE_DID so the prod number
 *     is never the only source and is never WRITTEN by this app (prod voice isolation, AGENTS §7).
 */
import { listRegisteredBundles, verifyPolicyBundle, DEFAULT_BUNDLE_VERSION } from '@/engine';

/** The signed DEFAULT policy bundle version (mirrors db/seed.ts + the engine's default bundle). */
export const DEFAULT_POLICY_BUNDLE_VERSION = DEFAULT_BUNDLE_VERSION;

/** Human label for the (currently fixed) bundle selection — the "verified" badge the demo shows. */
export function bundleVerifiedLabel(version: string = DEFAULT_POLICY_BUNDLE_VERSION): string {
  return `${version} · verified ✓`;
}

/**
 * A bundle as the config UI sees it (tk-0017). Display + verification metadata only — the rules
 * are summarized (id/name/forced action) so the selector can show "what this bundle escalates"
 * without ever shipping the thresholds or letting the UI mutate engine internals. The verification
 * fields are computed by the ENGINE (checksum recomputed, signature checked), never asserted here.
 */
export interface BundleSummary {
  /** The value written to Agent.policyBundleVersion (what the runtime + seed store). */
  version: string;
  /** The engine's internal policyVersion (metadata) — shown for provenance. */
  policyVersion: string;
  signedBy: string;
  checksum: string;
  checksumValid: boolean;
  signatureValid: boolean;
  isDefault: boolean;
  redFlagRules: { id: string; name: string; action: string }[];
}

/**
 * The available policy bundles for the selector — read live from the ENGINE'S registry
 * (`listRegisteredBundles`). This build ships the signed engine default (`default-0.1.0`) plus the
 * signed `familymed-v1` family-medicine bundle (tk-0025). Each bundle's checksum + signature come
 * from its own builder (signed when VOICE_CONFIG_HMAC_SECRET is set) and are verified with
 * `verifyPolicyBundle` so the "verified ✓" claim is real, not decorative.
 *
 * Pure read: no DB, no mutation. Driven by the registry so a newly registered bundle appears here
 * (and therefore in GET /api/bundles + the console Policies tab) without a shape change.
 */
export function listPolicyBundles(): BundleSummary[] {
  const secret = process.env.VOICE_CONFIG_HMAC_SECRET;
  return listRegisteredBundles().map((entry) => {
    const bundle = entry.build();
    // Verify WITH the secret only when one is configured (so signatureValid reflects reality);
    // structure + checksum are always verified.
    const verification = verifyPolicyBundle(bundle, secret || undefined);
    return {
      version: entry.version,
      policyVersion: bundle.metadata.policyVersion,
      signedBy: bundle.metadata.signedBy,
      checksum: bundle.metadata.checksum,
      checksumValid: verification.valid || !verification.errors.some((e) => e.startsWith('Checksum')),
      signatureValid: Boolean(bundle.metadata.signature) && verification.valid,
      isDefault: entry.isDefault,
      redFlagRules: bundle.redFlagRules.map((r) => ({ id: r.id, name: r.name, action: r.action })),
    };
  });
}

/** Whether a candidate version string is one of the available (selectable) bundle versions. */
export function isKnownBundleVersion(version: string): boolean {
  return listPolicyBundles().some((b) => b.version === version);
}

/**
 * The read-only DID shown when PHONE is enabled. Falls back to the documented demo rung so the
 * field is never empty. NOTE: display only — Cara Spark never buys/writes a per-agent number, and
 * never touches the prod Telnyx trunk; Lane G owns the standalone voice resources.
 */
export function demoPhoneDid(): string {
  return process.env.DEMO_PHONE_DID?.trim() || '+14157180498';
}
