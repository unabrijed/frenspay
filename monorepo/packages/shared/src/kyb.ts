// kyb.ts — what a PERSON has to tell us before they can settle other people's money, per country.
//
// ONE definition, used twice: the web client renders the form from it, and the backend validates
// against a mirror of it (apps/backend/src/lib/kyb.ts — the backend may only `import type` from this
// package, so runtime values are copied at the trust boundary; check-kyb.ts asserts they agree).
//
// Keyed by country because the identifiers are not translatable. A PAN means nothing in Indonesia,
// and asking an Indonesian LP for one — or worse, accepting a blank — would make the check theatre.
// A corridor with no entry here cannot submit at all, which is the correct failure: we should not be
// onboarding partners in a country whose identifiers we haven't thought about.
//
// A partner does not need a business (2026-09-02). The registered-business block that used to lead
// this form — legal name, entity type, GSTIN / NIB / NPWP, registered address — is gone: the pilot's
// partners are individuals, nothing ever cross-checked those identifiers, and a required field an
// individual cannot fill is a shut funnel. What remains is the person, the account the fiat will
// actually leave from, and the screening questions peer platforms ask.
//
// The identity of the PERSON is USUALLY established elsewhere: /merchants/apply requires the same
// tier-2 vendor KYC that gates cash-out. The exception is why `identity: true` exists. When the
// vendor is switched off (config.personaLive false — its credentials are blank on this deployment)
// that gate is dropped and the human reading THIS form is the identity check (docs/14). So every
// country spec must carry one required field naming the person.

export interface KybField {
  key: string;
  /** Shown above the input. */
  label: string;
  /** Shown under it — what the reviewer needs to see, in the LP's words. */
  hint?: string;
  optional?: boolean;
  /** Validated on BOTH sides. Anchored, case-insensitive, and deliberately loose: a format check
   *  catches a typo, it does not prove the identifier is real or belongs to this person. Only a
   *  registry lookup does that, and we don't have one — which is why a human still reads these. */
  pattern?: string;
  maxLen?: number;
  /** Fixed choices. Renders as a one-tap pick; validated on BOTH sides as exact membership. The
   *  stored value is the label itself — what the applicant tapped is what the reviewer reads. */
  options?: string[];
  /** Marks the one field that identifies the PERSON, not the business. check-kyb enforces exactly
   *  one identity field per country. Since 2026-09-03 it is asked only when the corridor's spec says
   *  so (`hidden` off) — the reviewer's decision rests on the person as described, not on a
   *  government number nothing ever verified (docs/14 §The grant that isn't, and this file's header). */
  identity?: boolean;
  /** Not rendered on the editable form. Still a known key: validated if present, shown in the
   *  read-only recap and in admin when a value is stored, and carried forward by the server on every
   *  resubmission so a hidden value is never dropped. Hidden implies optional (check-kyb asserts it —
   *  a hidden required field is unsubmittable). Bringing a field back is deleting this flag. */
  hidden?: boolean;
  /** An APPROVED partner changing this field re-opens the review: they go back to 'submitted' and
   *  offline until a human looks again (routes/merchant.ts, editMerchantKyb). Everything else they
   *  edit updates in place. The account fields carry it; a Telegram typo must not cost a working
   *  partner their queue. */
  recheck?: boolean;
}

/**
 * India. `payoutAccount` used to be the load-bearing one: the fiat leg is settled from the LP's OWN
 * account, and the documented failure mode for this business shape is personal accounts moving
 * third-party money and getting frozen (docs/06, docs/08). Since 2026-09-03 it is optional — partners
 * pay from several accounts, and no code ever compared it with a UTR; `accountDedicated` carries the
 * question that matters, and the reviewer asks the rest over Telegram. PAN is hidden the same day: the
 * peer product's form never asked for it, nothing screened it, and it stays in the spec as an optional
 * known key so it can be asked again by deleting one flag (docs/14).
 */
const INDIA: KybField[] = [
  // Ten characters, five letters, four digits, one letter. Every Indian taxpayer has one.
  {
    key: 'pan',
    label: 'PAN',
    hint: 'Yours. This is the name we check you against.',
    pattern: '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$',
    identity: true,
    optional: true,
    hidden: true,
    recheck: true,
  },
  {
    key: 'payoutAccount',
    label: 'The account you usually pay from',
    hint: 'A UPI ID or bank account, if you mostly use one. Leave blank if you pay from several.',
    maxLen: 120,
    optional: true,
    recheck: true,
  },
];

const INDONESIA: KybField[] = [
  // NIK is the 16-digit number on the KTP — the field that names the person. Hidden and optional for
  // the same reason PAN is on the India spec.
  {
    key: 'nik',
    label: 'NIK',
    hint: 'The 16-digit number on your KTP',
    pattern: '^[0-9]{16}$',
    identity: true,
    optional: true,
    hidden: true,
    recheck: true,
  },
  {
    key: 'payoutAccount',
    label: 'The account you usually pay from',
    hint: 'An e-wallet or bank account, if you mostly use one. Leave blank if you pay from several.',
    maxLen: 120,
    optional: true,
    recheck: true,
  },
];

/**
 * Country-agnostic screening, asked in the same submission as the personal identifiers — modelled
 * on what peer platforms ask before letting anyone in. Nothing here is verifiable and nothing
 * gates on it by itself; it exists so the human reviewing is judging a person with a stated
 * intent, not a PAN in a vacuum. Appended after each country's fields so `accountDedicated`
 * lands right under the `payoutAccount` it is asking about.
 */
const SCREENING: KybField[] = [
  {
    key: 'cryptoExperience',
    label: 'Your experience with digital money',
    hint: 'How familiar are you with USDC and wallets?',
    options: ['Just starting', 'Some experience', 'Active user', 'Professional'],
  },
  {
    key: 'profession',
    label: 'What you do today',
    options: ['Student', 'Freelancer', 'Full-time employee', 'Business owner', 'Homemaker'],
  },
  {
    // The numbers mirror apps/backend/src/services/merchantStats.ts — MIN_BOND ($100), LEVERAGE
    // {1: 1, 2: 3, 3: 5} and TIER_RULES (tier 2: 10 settled, 95% success, 3% disputes; tier 3: 50,
    // 98%, 1%, fast) — update this copy if any of them moves. The hint is where a partner learns what
    // staking more buys; the dashboard shows the same relation as "carries $X at once".
    key: 'plannedStake',
    label: 'How much you plan to stake',
    hint:
      'Your stake is the most you can carry in payouts at once: $300 staked means $300 in flight. It sits idle while you work and comes back when you leave. After 10 payouts, with 95% success and few disputes, you carry 3 times your stake. After 50, at 98% and fast, 5 times. Tiers move with your record, down as well as up.',
    options: ['$100, the minimum', '$100–300', 'Over $300', 'Not sure yet'],
  },
  {
    key: 'commitment',
    label: 'How long you plan to stay active',
    options: ['Under 3 months', '3–6 months', '6–12 months', 'A year or more', 'Not sure yet'],
  },
  {
    // The load-bearing one now that payoutAccount is optional: the documented failure mode is
    // third-party money moving through a personal account (docs/08). Dedicated is what we want; an
    // honest "shared" is a review conversation, not an auto-reject. Names the account itself, because
    // the field above it may be blank.
    key: 'accountDedicated',
    label: 'Do you pay from an account that is only for this work?',
    hint: 'A dedicated account, separate from your personal spending, is far less likely to be frozen.',
    options: ['Yes, dedicated to this', 'No, I also use it personally', 'I’ll open one before starting'],
    recheck: true,
  },
  {
    key: 'otherPlatforms',
    label: 'Where else you do this',
    hint: 'Anywhere else you send payouts for people. Leave blank if nowhere.',
    optional: true,
    maxLen: 200,
  },
  { key: 'heardAbout', label: 'How you found us', optional: true, maxLen: 120 },
  {
    // Required since 2026-09-02 (Bridge: "ask for their telegram as well"). The number on /apply is
    // for when a payout goes wrong; this is where the review conversation happens while the identity
    // vendor is off, and where a partner is reached about orders — the channel peer platforms use.
    key: 'contactTelegram',
    label: 'Your Telegram',
    hint: 'Where we follow up during review and reach you about orders. An @username or a t.me link.',
    maxLen: 64,
  },
];

/** ISO 3166-1 alpha-2 → the fields that country's LPs must supply. Countries come from rails.ts,
 *  which is the only country list (invariant 1); this says nothing about which countries exist,
 *  only what we ask the ones that do. */
export const KYB_FIELDS: Record<string, KybField[]> = {
  IN: [...INDIA, ...SCREENING],
  ID: [...INDONESIA, ...SCREENING],
};

/** Lifecycle of a business check. `more_info` is the one that matters: without it the only replies
 *  available to a reviewer are yes and no, and "no, and I won't say why" is how you lose an LP who
 *  simply mistyped their PAN. */
export type KybStatus = 'pending' | 'submitted' | 'under_review' | 'more_info' | 'approved' | 'rejected';

/** True while the merchant is the one who has to act. Drives whether the form is editable. */
export const kybAwaitingMerchant = (s: KybStatus): boolean => s === 'pending' || s === 'more_info';

/**
 * States a reviewer can decide FROM. Excludes 'pending' — nothing has been submitted, so there is
 * nothing to judge, and offering Approve there is how a business nobody has been told anything
 * about gets approved. Also excludes the two terminals: reopening one is a separate, deliberate act.
 * Mirrored in apps/backend/src/lib/kyb.ts, which enforces it; this copy is what stops the console
 * offering a button the server will refuse.
 */
export const KYB_DECIDABLE: readonly string[] = ['submitted', 'under_review', 'more_info'];

/**
 * Validate a submission against a country's spec. Returns the offending field keys, empty if clean.
 * Shared so the client can red-line a field before a round trip and the server can refuse the same
 * thing for real — the client copy is a courtesy, this call on the server is the trust boundary.
 */
export function validateKyb(country: string, fields: Record<string, unknown>): string[] {
  const spec = KYB_FIELDS[country];
  if (!spec) return ['country'];
  const bad: string[] = [];
  for (const f of spec) {
    const raw = fields[f.key];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) {
      if (!f.optional) bad.push(f.key);
      continue; // an omitted optional field is not checked against its pattern
    }
    if (f.maxLen && v.length > f.maxLen) bad.push(f.key);
    else if (f.pattern && !new RegExp(f.pattern).test(v)) bad.push(f.key);
    else if (f.options && !f.options.includes(v)) bad.push(f.key);
  }
  return bad;
}
