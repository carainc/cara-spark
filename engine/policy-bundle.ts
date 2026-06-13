/**
 * Policy bundle (FR-2) — checksum + create + verify. The checksum is the "tamper-proof" claim:
 * editing a rule/threshold changes it; editing only metadata does not. A tampered bundle fails
 * verifyPolicyBundle, and inference-check Check 3 calls verify → a tampered bundle is rejected
 * BEFORE adjudication. T2 (CAR-2363) adds the HMAC signature. Ported from VA-5. Pure — no AI, no DB.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PolicyBundle, UrgencyThresholds } from './types';
import { ALLOWED_ACTIONS, allowedActionSchema } from './types';
import { DEFAULT_RED_FLAG_RULES } from './redflags';

// Reconciled with VA-5 DEFAULT_URGENCY_THRESHOLDS (research/T1-va5-port-spec.md §2.7).
export const DEFAULT_URGENCY_THRESHOLDS: UrgencyThresholds = {
  abstentionThreshold: 0.3,
  oodThreshold: 0.7,
  reviewThreshold: 0.4,
  escalateThreshold: 0.7,
  urgentThreshold: 0.5,
  immediateCallbackThreshold: 0.8,
  selfCareConfidenceThreshold: 0.8,
};

export const DEFAULT_PROHIBITED_PATTERNS = [
  'dosage recommendation',
  'prescribe',
  'diagnose',
  'you have',
  'treatment plan',
  'take this medication',
  'increase your dose',
  'decrease your dose',
  'stop taking',
];

/** Stable canonical JSON — object keys sorted at every level; arrays left in order. */
function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

/** SHA-256 over {redFlagRules, urgencyThresholds, allowedActions, prohibitedOutputPatterns} — metadata excluded. */
export function computeBundleChecksum(bundle: PolicyBundle): string {
  const content = {
    redFlagRules: bundle.redFlagRules,
    urgencyThresholds: bundle.urgencyThresholds,
    allowedActions: bundle.allowedActions,
    prohibitedOutputPatterns: bundle.prohibitedOutputPatterns,
  };
  return createHash('sha256').update(canonicalize(content)).digest('hex');
}

export interface CreateBundleConfig {
  policyVersion: string;
  signedBy: string;
  changeNote: string;
  redFlagRules: PolicyBundle['redFlagRules'];
  urgencyThresholds: UrgencyThresholds;
  allowedActions: PolicyBundle['allowedActions'];
  prohibitedOutputPatterns: string[];
}

export function createPolicyBundle(config: CreateBundleConfig): PolicyBundle {
  const bundle: PolicyBundle = {
    metadata: {
      policyVersion: config.policyVersion,
      checksum: '',
      signedBy: config.signedBy,
      createdAt: new Date().toISOString(),
      changeNote: config.changeNote,
    },
    redFlagRules: config.redFlagRules,
    urgencyThresholds: config.urgencyThresholds,
    allowedActions: config.allowedActions,
    prohibitedOutputPatterns: config.prohibitedOutputPatterns,
  };
  bundle.metadata.checksum = computeBundleChecksum(bundle);
  return bundle;
}

export interface BundleVerifyResult {
  valid: boolean;
  errors: string[];
}

/** T1: checksum + structure. T2: pass `secret` to also require + verify the HMAC signature. */
export function verifyPolicyBundle(bundle: PolicyBundle, secret?: string): BundleVerifyResult {
  const errors: string[] = [];
  const m = bundle.metadata;
  if (!m?.policyVersion) errors.push('Missing policyVersion');
  if (!m?.checksum) errors.push('Missing checksum');
  if (!m?.signedBy) errors.push('Missing signedBy');

  const recomputed = computeBundleChecksum(bundle);
  if (m?.checksum && recomputed !== m.checksum) {
    errors.push(`Checksum mismatch (expected ${m.checksum}, got ${recomputed})`);
  }
  if (!Array.isArray(bundle.allowedActions) || bundle.allowedActions.length === 0) {
    errors.push('allowedActions is empty');
  } else {
    for (const a of bundle.allowedActions) {
      if (!allowedActionSchema.safeParse(a).success) errors.push(`Invalid action: ${String(a)}`);
    }
  }
  if (!bundle.urgencyThresholds) errors.push('Missing urgencyThresholds');
  if (!Array.isArray(bundle.redFlagRules)) errors.push('redFlagRules is not an array');

  if (secret !== undefined) {
    if (!bundle.metadata.signature) errors.push('Missing signature');
    else if (!verifyBundleSignature(bundle, secret)) errors.push('Signature mismatch');
  }

  return { valid: errors.length === 0, errors };
}

/** T2: sign a bundle — HMAC-SHA256 over its checksum (VOICE_CONFIG_HMAC_SECRET). */
export function signBundle(bundle: PolicyBundle, secret: string): PolicyBundle {
  const checksum = bundle.metadata.checksum || computeBundleChecksum(bundle);
  const signature = createHmac('sha256', secret).update(checksum).digest('hex');
  return {
    ...bundle,
    metadata: { ...bundle.metadata, checksum, signature, signatureAlgorithm: 'hmac-sha256' },
  };
}

/** Constant-time verify of the HMAC signature over the (recomputed) checksum. */
export function verifyBundleSignature(bundle: PolicyBundle, secret: string): boolean {
  const sig = bundle.metadata.signature;
  if (!sig || !secret) return false;
  const expected = createHmac('sha256', secret).update(computeBundleChecksum(bundle)).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The load gate (runbook: a bundle loads only if signature + checksum valid). Throws otherwise. */
export function loadPolicyBundle(bundle: PolicyBundle, secret: string): PolicyBundle {
  const v = verifyPolicyBundle(bundle, secret);
  if (!v.valid) throw new Error(`Refusing to load policy bundle: ${v.errors.join('; ')}`);
  return bundle;
}

const DEFAULT_POLICY_BASE: PolicyBundle = {
  metadata: {
    policyVersion: '1.0.0',
    checksum: '',
    signedBy: 'cara-spark-default',
    createdAt: '2026-03-08T00:00:00.000Z',
    changeNote: 'Initial default policy bundle (hand-authored; T3 AI-builder was CUT).',
  },
  redFlagRules: DEFAULT_RED_FLAG_RULES,
  urgencyThresholds: DEFAULT_URGENCY_THRESHOLDS,
  allowedActions: [...ALLOWED_ACTIONS],
  prohibitedOutputPatterns: DEFAULT_PROHIBITED_PATTERNS,
};

/** The default signed-on-load bundle. The engine runs against this until a custom bundle is authored. */
export const DEFAULT_POLICY: PolicyBundle = {
  ...DEFAULT_POLICY_BASE,
  metadata: { ...DEFAULT_POLICY_BASE.metadata, checksum: computeBundleChecksum(DEFAULT_POLICY_BASE) },
};

export const DEFAULT_POLICY_BUNDLE = DEFAULT_POLICY;

/**
 * The runtime "active" bundle: the default policy SIGNED with VOICE_CONFIG_HMAC_SECRET when it is set,
 * so the provable trace renders "signature verified ✓" (tk-0018). Falls back to the unsigned default
 * locally / in tests with no secret. Reading the env is a config/LOADER concern — the deterministic
 * DECISION (decide) stays env-free. The chat + voice paths adjudicate against this.
 */
export function activePolicyBundle(): PolicyBundle {
  const secret = process.env.VOICE_CONFIG_HMAC_SECRET;
  return secret ? signBundle(DEFAULT_POLICY, secret) : DEFAULT_POLICY;
}

// =============================================================================
// Bundle registry (tk-0025) — the single source resolving a DB version string → a signed bundle.
// =============================================================================

/** The DB version string under which the engine default is selected/stored (mirrors lib/auth/bundle). */
export const DEFAULT_BUNDLE_VERSION = 'default-0.1.0';

/**
 * A registered bundle: its DB version string + a builder that returns the runtime (signed-when-a-
 * secret-is-set) bundle, plus optional provenance metadata for the catalog. The builder reads the env
 * each call (loader concern) so a secret set after import still produces a signed bundle — exactly how
 * activePolicyBundle()/activeFamilymedBundle() already behave.
 */
export interface RegisteredBundle {
  version: string;
  build: () => PolicyBundle;
  isDefault: boolean;
  author?: string;
  source?: string;
}

/**
 * The registry. Adding a NEW signed bundle = one entry here; every consumer (GET /api/bundles via
 * lib/auth/bundle, the audit re-verify resolver, and the loop's per-agent resolution) reads through
 * `getRegisteredBundle` / `listRegisteredBundles`, so a new bundle surfaces everywhere at once. The
 * familymed-v1 entry is appended in engine/index.ts to avoid an import cycle (familymed-bundle.ts
 * imports the create/sign helpers from this file).
 */
const BUNDLE_REGISTRY = new Map<string, RegisteredBundle>([
  [DEFAULT_BUNDLE_VERSION, { version: DEFAULT_BUNDLE_VERSION, build: activePolicyBundle, isDefault: true }],
]);

/** Register (or replace) a bundle by its DB version string. Idempotent. */
export function registerBundle(entry: RegisteredBundle): void {
  BUNDLE_REGISTRY.set(entry.version, entry);
}

/** Resolve a DB version string → its runtime (signed-when-secret-set) bundle, or null if unknown. */
export function getRegisteredBundle(version: string): PolicyBundle | null {
  const entry = BUNDLE_REGISTRY.get(version);
  return entry ? entry.build() : null;
}

/** The registered bundle metadata (version + provenance), default first, for the catalog. */
export function listRegisteredBundles(): RegisteredBundle[] {
  return [...BUNDLE_REGISTRY.values()].sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
}
