// kyb.ts — the backend's MIRROR of packages/shared/src/kyb.ts.
//
// The backend may only `import type` from @fpay/shared (see lib/units.ts header), so the runtime
// spec is copied at the trust boundary exactly like PAYOUT_METHODS and VPA_RE in lib/corridors.ts.
// check-rails.ts asserts the two stay in step — a field that exists on the form but not here would
// be silently unvalidated, and one that exists here but not on the form would be permanently
// unsubmittable.
//
// Validation here is the TRUST BOUNDARY. The client validates the same rules first, but only as a
// courtesy so a typo doesn't cost a round trip; nothing the client says is believed.

/** Mirrors KybField in packages/shared/src/kyb.ts. */
export interface KybFieldSpec {
  key: string;
  optional?: boolean;
  /** Not on the editable form; the route carries a stored value forward so it is never dropped. */
  hidden?: boolean;
  /** An approved partner changing this re-opens the review (editMerchantKyb). */
  recheck?: boolean;
  pattern?: RegExp;
  maxLen?: number;
  /** Fixed choices — validated as exact membership. The stored value is the label itself. */
  options?: string[];
}

// A partner does not need a business: the person's identifier and the account the fiat leaves from
// (shared/kyb.ts header, 2026-09-02).
const INDIA: KybFieldSpec[] = [
  { key: 'pan', pattern: /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, optional: true, hidden: true, recheck: true },
  { key: 'payoutAccount', maxLen: 120, optional: true, recheck: true },
];

const INDONESIA: KybFieldSpec[] = [
  { key: 'nik', pattern: /^[0-9]{16}$/, optional: true, hidden: true, recheck: true },
  { key: 'payoutAccount', maxLen: 120, optional: true, recheck: true },
];

/** Country-agnostic screening — mirrors SCREENING in shared/kyb.ts. One line per field: check-kyb
 *  compares each entry's options/optional/maxLen against the shared spec line by line. */
const SCREENING: KybFieldSpec[] = [
  { key: 'cryptoExperience', options: ['Just starting', 'Some experience', 'Active user', 'Professional'] },
  { key: 'profession', options: ['Student', 'Freelancer', 'Full-time employee', 'Business owner', 'Homemaker'] },
  { key: 'plannedStake', options: ['$100, the minimum', '$100–300', 'Over $300', 'Not sure yet'] },
  { key: 'commitment', options: ['Under 3 months', '3–6 months', '6–12 months', 'A year or more', 'Not sure yet'] },
  { key: 'accountDedicated', options: ['Yes, dedicated to this', 'No, I also use it personally', 'I’ll open one before starting'], recheck: true },
  { key: 'otherPlatforms', optional: true, maxLen: 200 },
  { key: 'heardAbout', optional: true, maxLen: 120 },
  { key: 'contactTelegram', maxLen: 64 },
];

export const KYB_FIELDS: Record<string, KybFieldSpec[]> = {
  IN: [...INDIA, ...SCREENING],
  ID: [...INDONESIA, ...SCREENING],
};

/** Statuses in which the MERCHANT is the one who has to act, so a submission is accepted. */
export const KYB_SUBMITTABLE: readonly string[] = ['pending', 'more_info'];

/** Statuses from which a partner may EDIT what they sent (routes/merchant.ts). A change to a `recheck`
 *  field sends them back to 'submitted' and offline; anything else updates in place. Not 'submitted'
 *  or 'under_review' — nobody edits a form a reviewer is reading. */
export const KYB_EDITABLE_FROM: readonly string[] = ['approved'];

/** Keys the form never renders. The route carries their stored values forward on every submission, so
 *  a client that sends only what it rendered cannot drop a hidden PAN. */
export const hiddenKeys = (country: string): string[] => (KYB_FIELDS[country] ?? []).filter((f) => f.hidden).map((f) => f.key);

/** Keys whose change re-opens the review. */
export const recheckKeys = (country: string): string[] => (KYB_FIELDS[country] ?? []).filter((f) => f.recheck).map((f) => f.key);

/** Statuses a reviewer may decide from. Excludes 'pending' (nothing submitted to judge) and the two
 *  terminals — reopening an approved or rejected merchant is a different, deliberate action.
 *  MIRRORS KYB_DECIDABLE in packages/shared/src/kyb.ts; this copy is the one that enforces. */
export const KYB_DECIDABLE: readonly string[] = ['submitted', 'under_review', 'more_info'];

/**
 * Validate and NORMALISE a submission. Returns the trimmed field set to store, or the offending
 * keys. Trimming here rather than at the call site is the point: the stored value is what a human
 * reviews and what a later lookup would compare, and ' ABCDE1234F ' is not the same string as the
 * PAN it contains.
 *
 * Unknown keys are DROPPED, not rejected — a client on an older build sending a retired field
 * should not be told its whole submission is malformed, and storing arbitrary caller-supplied keys
 * in a jsonb column is how that column becomes a dumping ground.
 */
export function validateKybFields(
  country: string,
  input: Record<string, unknown> | undefined,
): { ok: true; fields: Record<string, string> } | { ok: false; invalid: string[] } {
  const spec = KYB_FIELDS[country];
  if (!spec) return { ok: false, invalid: ['country'] };
  const src = input ?? {};
  const fields: Record<string, string> = {};
  const invalid: string[] = [];
  for (const f of spec) {
    const raw = src[f.key];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) {
      if (!f.optional) invalid.push(f.key);
      continue; // an omitted optional field is never pattern-checked
    }
    if (f.maxLen && v.length > f.maxLen) invalid.push(f.key);
    else if (f.pattern && !f.pattern.test(v)) invalid.push(f.key);
    else if (f.options && !f.options.includes(v)) invalid.push(f.key);
    else fields[f.key] = v;
  }
  return invalid.length ? { ok: false, invalid } : { ok: true, fields };
}
