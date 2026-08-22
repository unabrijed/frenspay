// check-copy.mjs — words that must never reach a screen. Two rules, different surfaces.
//
// fpay is maintained as a software / IT service provider, not a payment or merchant-acquiring
// business, so the word cannot appear in anything a customer or a partner reads. It stays freely
// usable in code: the `merchants` table is the LP that settles the fiat leg, and `MerchantProfile`,
// `merchant_confirms` and `/merchants/*` are all internal — none of them render.
//
// So this has to tell COPY from CODE, and it cannot do it by looking at quotes alone: most of the
// hits this was written for were bare JSX text (`<Txt …>Become a merchant</Txt>`, `Merchant gets`),
// which is not quoted at all, and some of it spans lines. What it does instead is look for PROSE —
// a run of two or more plain words separated by single spaces — and ignore everything else. Code
// breaks that pattern almost immediately: `s.merchant`, `merchant: MerchantProfile`, `!merchant`,
// `getMerchantOrders(` are all one word or less by this measure.
//
// apps/mobile IS covered despite living outside the workspace — it cannot be typechecked or
// built, so this is the only gate it has. See RULES below for which rule covers which surface.
//
// Run: yarn check:copy
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Whole words only. `MerchantOrder`, `merchant_confirms` and `getMerchantOrders` have no right
 *  boundary and never match; `merchant account` and `Merchants settle` do.
 *
 *  "shop" is banned alongside it because it is not a synonym problem, it is the same claim in
 *  plainer words: the copy this replaced read "a one-time check to pay shops across India". */
const MERCHANT = /\b(merchants?|storefronts?|shops?)\b/i;

/** The invitation surface only. The frenspay v2 system says the world comes first and the product
 *  reveals later: "no balance, wallet, forex, exchange rate, QR — those belong to the reveal, not
 *  the invitation." The landing is the invitation, so the mechanics of the app cannot appear on it.
 *  Inside the app these words are not merely allowed, they are the correct ones. */
const PRODUCT = /\b(balances?|wallets?|forex|exchange rates?|QR codes?|QR)\b/i;

const or = (...rx) => new RegExp(rx.map((r) => r.source).join('|'), 'i');

/** Which rule applies where. The landing carries BOTH: it is the invitation and it is also
 *  customer-facing, so the merchant rule never stopped applying to it.
 *  apps/admin is deliberately absent — an internal operator console, neither customer- nor
 *  partner-facing. */
const RULES = [
  { dir: 'apps/web/src', banned: MERCHANT },
  { dir: 'apps/lp/src', banned: MERCHANT },
  { dir: 'apps/mobile/src', banned: MERCHANT },
  // The sheets and product components live here now (shared by web + mobile): the gate follows them.
  { dir: 'packages/app/src', banned: MERCHANT },
  { dir: 'apps/landing/src', banned: or(MERCHANT, PRODUCT) },
];
const DIRS = RULES.map((r) => r.dir);

/** A word: letters, with an apostrophe inside and sentence punctuation allowed to trail. `:` and
 *  `;` are NOT trailing punctuation — that is the whole reason `merchant: MerchantProfile` reads
 *  as one word rather than two. */
const WORD = "[A-Za-z][A-Za-z'’]*[,.!?]?";
const PROSE = new RegExp(`${WORD}(?:[ \\t]+${WORD})+`, 'g');

/** Prose never starts right after one of these. Code constantly does — `[merchant, reload]`,
 *  `const { payRupees, merchant }`, `(merchant, x)`. A preceding `>` (JSX text), quote (a string
 *  literal) or sentence punctuation (line two of a wrapped paragraph) all mean real copy. */
const CODE_LEAD = /[[({,=;:$_#&|]/;

/** A run led by one of these is a declaration, not a sentence. */
const KEYWORD = /^(const|let|var|function|return|import|export|type|interface|await|async|new|typeof|extends|implements)\b/;

/** Comments explain this rule and necessarily name the word — apps/web/src/components/RateLock.tsx
 *  spells it out in full. Blanked rather than deleted so every offset, and therefore every reported
 *  line number, still refers to the real file. */
const blank = (m) => m.replace(/[^\n]/g, ' ');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/.*$/gm, blank);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

// ponytail: a heuristic, not a parser — copy assembled from variables, or a banned word alone on
// the second line of a wrapped paragraph, can still slip past. Swap for an AST pass or a real i18n
// catalog if copy ever moves out of JSX.
const failures = [];
for (const { dir, banned: BANNED } of RULES) {
  for (const file of walk(dir)) {
    const src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    const hit = (i, text) => failures.push(`${file}:${lineOf(src, i)}  ${text.trim()}`);

    for (const m of src.matchAll(PROSE)) {
      if (!BANNED.test(m[0]) || KEYWORD.test(m[0])) continue;
      const before = src.slice(0, m.index).replace(/[ \t]+$/, '').slice(-1);
      if (CODE_LEAD.test(before)) continue;
      hit(m.index, m[0]);
    }

    // One word is not prose, so the loop above cannot see a bare `'Merchant'` — which is exactly
    // the shape of a fallback payee name (usePayStore's `res.name ?? res.payee ?? …`), and it
    // renders as the sheet title. A literal fenced by `|` is a type union member, not copy
    // (`role: 'user' | 'merchant' | 'admin'`).
    for (const m of src.matchAll(/(['"`])\s*([A-Za-z]+)\s*\1/g)) {
      if (!BANNED.test(m[2])) continue;
      const before = src.slice(0, m.index).replace(/\s+$/, '').slice(-1);
      const after = src.slice(m.index + m[0].length).replace(/^\s+/, '').slice(0, 1);
      if (before === '|' || after === '|') continue;
      hit(m.index, m[0]);
    }
  }
}

if (failures.length) {
  console.error(`check-copy: ${failures.length} banned word(s) in user-facing copy\n`);
  for (const f of failures) console.error('  ✗ ' + f);
  console.error('\n  fpay is a software/IT service provider. Say "partner" (the LP that settles),');
  console.error('  or name the action ("scan and pay"). The word is still fine in code,');
  console.error('  comments, type names and API paths — this only reads prose.');
  console.error('\n  On apps/landing the product words are banned too: the landing is the');
  console.error('  invitation, and balance / wallet / forex / exchange rate / QR belong to the');
  console.error('  reveal. Say what it is for, not how it works.\n');
  process.exit(1);
}
console.log(`check-copy: OK — no banned copy in ${DIRS.join(', ')}.`);
