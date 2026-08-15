// check-env.mjs — assert the env tier convention is the same in every app.
//
// Each app reads env through its own `envConfig.ts`, and that duplication is deliberate: Next only
// inlines LITERAL `process.env.NEXT_PUBLIC_*` references appearing in the app's own source, so the
// reader cannot live in @fpay/shared; and the backend may only `import type` from shared (runtime
// value imports fail under tsx). Identical-by-import is impossible, so this asserts
// identical-by-comparison instead — the same trick apps/landing/scripts/check-email.mjs uses for
// the waitlist validator.
//
// Run: yarn check:env
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const NEXT_APPS = [
  { name: 'web', path: 'apps/web/src/services/envConfig.ts', src: 'apps/web/src' },
  { name: 'admin', path: 'apps/admin/src/services/envConfig.ts', src: 'apps/admin/src' },
  { name: 'lp', path: 'apps/lp/src/services/envConfig.ts', src: 'apps/lp/src' },
  { name: 'landing', path: 'apps/landing/src/lib/envConfig.ts', src: 'apps/landing/src' },
];
const BACKEND = 'apps/backend/src/envConfig.ts';

const failures = [];
const fail = (msg) => failures.push(msg);

/** The tier block: the first `const isProduction` through the end of `pick()`. Whitespace-collapsed
 *  so the comparison is about semantics, not formatting. */
function tierBlock(src, name) {
  const start = src.indexOf('const isProduction');
  const end = src.indexOf('\n}', src.indexOf('function pick('));
  if (start === -1 || end === -1) {
    fail(`${name}: could not locate the tier block (const isProduction … end of pick())`);
    return null;
  }
  return src.slice(start, end + 2).replace(/\s+/g, ' ').trim();
}

/** Files under `dir` that read process.env outside their own envConfig. */
function strayEnvReads(dir) {
  let listing;
  try {
    listing = execFileSync(
      'grep',
      ['-rn', '--include=*.ts', '--include=*.tsx', 'process\\.env\\.', join(ROOT, dir)],
      { encoding: 'utf8' },
    );
  } catch {
    return []; // grep exits 1 when nothing matches
  }
  return listing
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.replace(ROOT + '/', ''))
    .filter((l) => !l.slice(0, l.indexOf(':')).endsWith('envConfig.ts'));
}

// 1) The three Next apps must resolve tiers identically.
const [reference, ...rest] = NEXT_APPS.map((a) => ({ ...a, block: tierBlock(read(a.path), a.name) }));
for (const app of rest) {
  if (reference.block && app.block && app.block !== reference.block) {
    fail(
      `${app.name} (${app.path}) tier block has drifted from ${reference.name} (${reference.path}).\n` +
        `      ${reference.name}: ${reference.block}\n      ${app.name}: ${app.block}`,
    );
  }
}

// 2) Nothing else may read process.env. A bare read skips the tier chain entirely — exactly how the
// landing waitlist ended up posting to localhost on a stage deploy.
for (const app of NEXT_APPS) {
  for (const hit of strayEnvReads(app.src)) {
    fail(`${app.name}: reads process.env outside ${app.path}\n      ${hit}`);
  }
}

// 3) Nothing secret-shaped may reach the browser UNGUARDED.
//
// Everything under NEXT_PUBLIC_* is inlined into the client bundle as a literal, so the prefix — not
// the file — is the real security boundary. A var that needs to stay private simply must not carry
// the prefix. One legitimately does carry it (the local dev signing key), and the only thing that
// keeps it out of a shipped bundle is being read inside an `isProduction` branch, where it becomes
// dead code a production build eliminates. Measured, not assumed: gating merely the *export* while
// the read sat in the eagerly-built `E` object still inlined the key into three chunks.
//
// The definitive proof is the sentinel build documented in the plan; this is the fast static guard
// that stops a NEW one being added without the same treatment.
const SECRET_SHAPED = /NEXT_PUBLIC_(?:[A-Z0-9_]*_)?(?:SECRET|PRIVATE|PASSWORD|MNEMONIC|SEED)[A-Z0-9_]*/g;
/** Analyse code, not prose — these files explain the rule in comments that name the very vars. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
for (const app of NEXT_APPS) {
  const src = stripComments(read(app.path));
  // Split on export statements so each secret-shaped read can be attributed to its own export.
  const statements = src.split(/\bexport const /).slice(1);
  for (const stmt of statements) {
    const names = [...new Set(stmt.match(SECRET_SHAPED) ?? [])];
    if (!names.length) continue;
    if (!/\bisProduction\b/.test(stmt.split('\n').slice(0, 6).join('\n'))) {
      fail(
        `${app.name}: ${names.join(', ')} is read into the client bundle without an isProduction guard.\n` +
          `      Either drop the NEXT_PUBLIC_ prefix (server-only), or read it inside\n` +
          `      \`isProduction ? '' : process.env.NEXT_PUBLIC_…\` so a production build strips it.\n` +
          `      Guarding only the export is NOT enough — a read in the shared \`E\` object still inlines.`,
      );
    }
  }
  // The bare (production) name of a secret must never be referenced at all: a dev-only credential
  // has no production tier, so setting it on a prod host should be inert rather than merely gated.
  for (const name of new Set(src.match(SECRET_SHAPED) ?? [])) {
    if (!/NEXT_PUBLIC_(LOCAL|STAGE)_/.test(name)) {
      fail(`${app.name}: ${name} is a bare production-tier secret name — a dev-only credential must not have one.`);
    }
  }
}

// 4) The backend keys off NODE_ENV, but must use the same three tiers and the same prefix rule.
const backend = read(BACKEND);
for (const needle of ['LOCAL_${key}', 'STAGE_${key}', 'process.env[key]']) {
  if (!backend.includes(needle)) fail(`backend (${BACKEND}): tier chain is missing \`${needle}\``);
}
if (!/isProduction\s*=\s*!isDevelopment/.test(backend)) {
  fail(`backend (${BACKEND}): isProduction is no longer the complement of isDevelopment`);
}

if (failures.length) {
  console.error(`check-env: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error('  ✗ ' + f + '\n');
  process.exit(1);
}
console.log(`check-env: OK — ${NEXT_APPS.length} Next apps share one tier block, backend agrees.`);
