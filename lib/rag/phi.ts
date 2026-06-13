/**
 * PHI gate for the referral-RAG ingest path (T12 / CAR-2391).
 *
 * Referral resources are PUBLIC community info (food banks, CHCs, shelters). They must contain
 * NO protected health information. This module REJECTS PHI-shaped uploaded content at the door —
 * a load-bearing safety boundary (AGENTS.md §Security: "No PHI in ... string literals"; the RAG
 * corpus is advisory + decision-inert and must never become a PHI sink).
 *
 * Pure — no AI, no DB, no network. Pattern-based, fail-closed: when in doubt, reject. We would
 * rather block a borderline-clean doc than admit one identifier.
 *
 * NOTE: this is a structural shape detector, not an NLP de-identifier. It catches the
 * machine-shaped identifiers (SSN, MRN, DOB, phone, email, member ids) that have no business in a
 * public resource listing, plus the "NAME, DOB" clinical-record shape. Free-text names alone are
 * not reliably detectable and are out of scope by design — the rejection is on STRUCTURE.
 *
 * Identifier-shaped regexes are assembled from digit-count fragments (e.g. `d(3)`) rather than
 * written as literal digit runs, so no identifier-shaped string literal ever lives in the repo.
 */

export type PhiKind =
  | 'ssn'
  | 'mrn'
  | 'date_of_birth'
  | 'phone'
  | 'email'
  | 'member_id'
  | 'patient_label';

export interface PhiMatch {
  kind: PhiKind;
  /** A redacted excerpt — we never echo the raw match into logs/UI. */
  excerpt: string;
}

export interface PhiScanResult {
  clean: boolean;
  matches: PhiMatch[];
}

/** `\d{n}` without a literal digit-run in source. */
const d = (n: number) => `\\d{${n}}`;
/** `\d{min,max}`. */
const dRange = (min: number, max: number) => `\\d{${min},${max}}`;

/** Mask all but the last 2 chars so a rejection message never re-leaks the identifier. */
function redact(raw: string): string {
  const s = String(raw);
  if (s.length <= 2) return '••';
  return `${'•'.repeat(Math.min(s.length - 2, 8))}${s.slice(-2)}`;
}

interface PhiPattern {
  kind: PhiKind;
  re: RegExp;
}

// Ordered most-specific → least. Each is anchored on word boundaries to limit false positives.
const PHI_PATTERNS: PhiPattern[] = [
  // US national identifier: nnn-nn-nnnn (assembled from fragments — no literal run in source).
  { kind: 'ssn', re: new RegExp(`\\b${d(3)}-${d(2)}-${d(4)}\\b`, 'g') },
  { kind: 'ssn', re: new RegExp(`\\bssn[:#]?\\s*${d(9)}\\b`, 'gi') },
  // Medical record number / member id when explicitly labeled (the label is the signal).
  {
    kind: 'mrn',
    re: /\b(?:mrn|medical\s+record\s+(?:no\.?|number|#)|chart\s*#)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi,
  },
  {
    kind: 'member_id',
    re: /\b(?:member|subscriber|policy|insurance)\s*(?:id|no\.?|number|#)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi,
  },
  // Date of birth — the label makes a date PHI (event dates/hours on a flyer are fine).
  {
    kind: 'date_of_birth',
    re: new RegExp(
      `\\b(?:dob|d\\.o\\.b\\.?|date\\s+of\\s+birth|born(?:\\s+on)?)\\s*[:#]?\\s*(?:${dRange(1, 2)}[\\/.\\-]${dRange(
        1,
        2,
      )}[\\/.\\-]${dRange(2, 4)}|${d(4)}-${d(2)}-${d(2)})\\b`,
      'gi',
    ),
  },
  // "Patient: <name>" / "Pt name:" — the clinical-record framing. The "patient:"/"pt:" label
  // followed by any word has no place in a PUBLIC resource listing, so we reject it fail-closed
  // (case-insensitive). A clean resource describes a place/program, never an individual patient.
  {
    kind: 'patient_label',
    re: /\b(?:patient|pt\.?)\s*(?:name)?\s*[:#]\s*[A-Za-z]{2,}/gi,
  },
  // Email.
  { kind: 'email', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
];

/**
 * Phone numbers get special handling: an ORG contact line ("Call us: 555-123-4567") is legitimate
 * for a referral resource, so a bare phone number alone is NOT treated as PHI. We only flag a phone
 * when it is co-located with a personal-record signal (patient/DOB/MRN) in the same document.
 */
const PHONE_RE = new RegExp(
  `\\b(?:\\+?1[-.\\s]?)?\\(?${d(3)}\\)?[-.\\s]?${d(3)}[-.\\s]?${d(4)}\\b`,
  'g',
);

/** Does the text carry a record-shaped personal signal (beyond a plain phone/email)? */
function hasPersonalRecordSignal(matches: PhiMatch[]): boolean {
  return matches.some((m) => m.kind !== 'phone' && m.kind !== 'email');
}

export function scanForPhi(text: string): PhiScanResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { clean: true, matches: [] };
  }

  const matches: PhiMatch[] = [];
  for (const { kind, re } of PHI_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ kind, excerpt: redact(m[0]) });
      if (m.index === re.lastIndex) re.lastIndex += 1; // guard against zero-width loops
    }
  }

  // Phone: only count it as PHI when a personal-record signal is also present.
  PHONE_RE.lastIndex = 0;
  const phones: PhiMatch[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = PHONE_RE.exec(text)) !== null) {
    phones.push({ kind: 'phone', excerpt: redact(pm[0]) });
  }
  if (phones.length > 0 && hasPersonalRecordSignal(matches)) {
    matches.push(...phones);
  }

  return { clean: matches.length === 0, matches };
}

/** Thrown by the ingest path when an upload is PHI-shaped. Carries kinds only — never the raw value. */
export class PhiRejectedError extends Error {
  readonly kinds: PhiKind[];
  constructor(matches: PhiMatch[]) {
    const kinds = [...new Set(matches.map((m) => m.kind))];
    super(
      `Upload rejected: referral resources must contain no PHI. Detected ${kinds.length} PHI-shaped pattern(s): ${kinds.join(', ')}. Remove personal identifiers and re-upload.`,
    );
    this.name = 'PhiRejectedError';
    this.kinds = kinds;
  }
}

/** Fail-closed guard used by the ingest path. Throws PhiRejectedError if the text looks like PHI. */
export function assertNoPhi(text: string): void {
  const result = scanForPhi(text);
  if (!result.clean) throw new PhiRejectedError(result.matches);
}
