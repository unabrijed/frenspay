// check-fetch.mjs — every request a frontend makes goes through its app's ONE api helper.
//
// The helper is where the Privy token is attached on every call, where a 401 refreshes and retries,
// where no_account / account_suspended reach the store, and where the content-type rule lives
// (check-api-headers). A raw fetch() anywhere else has none of that — it works on the developer's
// machine (dev header, no gate) and 401s for a user. Four files may call fetch: the three helpers
// (web re-exports @fpay/app's) and the landing page's public waitlist POST.
//
// Run: yarn check:fetch
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOW = new Set([
  'packages/app/src/services/api.ts',
  'apps/lp/src/services/api.ts',
  'apps/admin/src/services/api.ts',
  'apps/landing/src/lib/waitlist.ts',
]);
const DIRS = ['apps/web', 'apps/lp', 'apps/admin', 'apps/mobile', 'apps/landing', 'packages/app', 'packages/ui', 'packages/shared'].map((d) => `${d}/src`);

let listing = '';
try {
  listing = execFileSync(
    'grep',
    ['-rnE', '--include=*.ts', '--include=*.tsx', '\\bfetch\\(', ...DIRS.map((d) => join(ROOT, d))],
    { encoding: 'utf8' },
  );
} catch (e) {
  if (e.status !== 1) throw e; // grep exits 1 when nothing matches
}

const stray = listing
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => l.replace(ROOT + '/', ''))
  // a comment that mentions fetch() is not a call
  .filter((l) => !/^[^:]+:\d+:\s*(\/\/|\*|\/\*)/.test(l))
  .filter((l) => !ALLOW.has(l.slice(0, l.indexOf(':'))));

if (stray.length) {
  console.error('check-fetch: raw fetch() outside the api helpers — route it through services/api.ts:');
  for (const l of stray) console.error('  ' + l);
  process.exit(1);
}
console.log('check-fetch: ok');
