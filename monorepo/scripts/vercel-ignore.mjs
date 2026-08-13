// vercel-ignore.mjs — decide whether a Vercel project should build this commit.
//
// Wired as `ignoreCommand` in each app's vercel.json. Vercel's exit codes are inverted from
// intuition and the whole file hangs off that: EXIT 0 = SKIP the build, EXIT 1 = BUILD it.
//
// Why this exists: Vercel's built-in "Skip deployment for unaffected projects" keys off the
// project's Root Directory, and admin's Root Directory IS monorepo/apps/admin — so editing that
// app's README deployed the app. It is extension-blind. Deployments are metered, README edits are
// frequent, and the house rule is that a docs-only push deploys nothing.
//
// Fail-safe direction is deliberate: every case we cannot decide BUILDS. A wasted deployment costs
// money once. A wrongly skipped one leaves a stale build on a live domain and is discovered later,
// by someone confused about why their fix never shipped.
//
// Run: node scripts/vercel-ignore.mjs <admin|web|landing>
//      node scripts/vercel-ignore.mjs --check    (asserts the rules below; no git, no network)
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Paths exactly as `git diff --name-only` reports them: from the GIT root, which is the directory
// above the monorepo (there is a payments/ wrapper — see apps/admin/next.config.ts).
const COMMON = ['monorepo/package.json', 'monorepo/yarn.lock', 'monorepo/tsconfig'];
const SHARED = 'monorepo/packages/shared/';

const SCOPES = {
  admin: [...COMMON, SHARED, 'monorepo/apps/admin/'],
  web: [...COMMON, SHARED, 'monorepo/apps/web/', 'monorepo/vercel.json'],
  // Landing does not consume @fpay/shared, so a shared change must not wake it.
  landing: [...COMMON, 'monorepo/apps/landing/'],
};

/** Files that cannot change what a build outputs, wherever they sit. */
const DOCS = [/\.md$/, /(^|\/)\.env\.example$/, /(^|\/)\.gitignore$/];

/** Pure: given the changed paths, must `app` rebuild? Everything testable lives here. */
export function shouldBuild(app, changed) {
  const scope = SCOPES[app];
  if (!scope) return true; // unknown app name → build; never silently skip on a typo
  return changed.filter((p) => !DOCS.some((re) => re.test(p))).some((p) => scope.some((s) => p.startsWith(s)));
}

const SKIP = 0;
const BUILD = 1;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

function main(app) {
  // A project only ever sees VERCEL_ENV=production on its OWN Production Branch, so this is also
  // the branch pin — and a better one than naming a branch, because the stage and prod projects
  // share this file and would need different names. Previews and everything else: skip.
  if (process.env.VERCEL_ENV !== 'production') return SKIP;

  // No parent commit reachable (first deploy, or a clone too shallow to diff) → we cannot tell.
  try {
    git('rev-parse', 'HEAD^');
  } catch {
    return BUILD;
  }

  const changed = git('diff', '--name-only', 'HEAD^', 'HEAD').split('\n').filter(Boolean);
  return shouldBuild(app, changed) ? BUILD : SKIP;
}

// Only act when run as a command. Without this guard, `import`ing the module for a dry run falls
// through to the exit below and kills the importing process — silently, with a 0.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (!isMain) {
  // imported for shouldBuild(); nothing to do
} else if (process.argv[2] === '--check') {
  const { strict: assert } = await import('node:assert');
  const t = (changed, expected, why) => {
    for (const app of ['admin', 'web', 'landing']) {
      assert.equal(shouldBuild(app, changed), expected[app], `${app}: ${why} — ${JSON.stringify(changed)}`);
    }
  };
  const all = { admin: true, web: true, landing: true };
  const none = { admin: false, web: false, landing: false };

  // The push that prompted this file: two docs files inside an app directory.
  t(['monorepo/apps/admin/README.md', 'monorepo/apps/admin/.env.example'], none, 'docs in an app dir deploy nothing');
  t(['monorepo/apps/admin/next.config.ts'], { ...none, admin: true }, 'app code wakes only its own app');
  t(['monorepo/packages/shared/src/units.ts'], { admin: true, web: true, landing: false }, 'landing skips shared');
  t(['monorepo/yarn.lock'], all, 'a dependency change can move any output');
  t(['monorepo/docs/01-architecture.md'], none, 'docs/ is outside every scope');
  t(['monorepo/DEPLOY.md'], none, 'so are the runbooks');
  t(['monorepo/apps/backend/src/routes/auth.ts'], none, 'the backend is Railway, not Vercel');
  // Mixed: docs are dropped first, then what remains decides.
  t(['monorepo/apps/web/README.md', 'monorepo/apps/web/src/app/page.tsx'], { ...none, web: true }, 'code beside docs');
  // A typo in the wiring must not silently mute a project.
  assert.equal(shouldBuild('addmin', ['monorepo/apps/admin/README.md']), true, 'unknown app builds');

  console.log('vercel-ignore: OK — 9 cases, docs never deploy, unknowns always build');
} else {
  process.exit(main(process.argv[2]));
}
