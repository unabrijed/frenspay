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
// It also gates the BACKEND, which is not a Vercel project at all: .github/workflows/backend-image.yml
// runs `... backend` to decide whether to build and ship the Railway image. That gate used to be
// `watchPatterns` in the root railway.json — a second copy of these rules, in another syntax, that
// nothing tested. One set of scopes, one self-test, both platforms.
//
// Run: node scripts/vercel-ignore.mjs <admin|web|lp|landing|backend>
//      node scripts/vercel-ignore.mjs --check    (asserts the rules below; no git, no network)
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Paths exactly as `git diff --name-only` reports them: from the GIT root, which is the directory
// above the monorepo (there is a payments/ wrapper — see apps/admin/next.config.ts).
const COMMON = ['monorepo/package.json', 'monorepo/yarn.lock', 'monorepo/tsconfig'];
const SHARED = 'monorepo/packages/shared/';
// The design system is its own package, so it needs its own entry — SHARED is literally
// packages/shared/, and a UI change would otherwise wake nobody.
const UI = 'monorepo/packages/ui/';

const SCOPES = {
  admin: [...COMMON, SHARED, 'monorepo/apps/admin/'],
  web: [...COMMON, SHARED, UI, 'monorepo/apps/web/', 'monorepo/vercel.json'],
  lp: [...COMMON, SHARED, UI, 'monorepo/apps/lp/'],
  // Landing consumes neither package, so a shared or UI change must not wake it.
  landing: [...COMMON, 'monorepo/apps/landing/'],
  // Not a Vercel project — this scope decides whether CI builds and ships the Railway image.
  // The build files are git-root-relative (no monorepo/ prefix) because that is where they live,
  // and a change to any of them changes the deploy without touching a line of backend source. The
  // workflow belongs here for the same reason the Dockerfile does: editing it and having the gate
  // answer "nothing changed" means the edit cannot be tested at all.
  // packages/ui is deliberately absent: the backend renders nothing.
  backend: [...COMMON, SHARED, 'monorepo/apps/backend/', 'Dockerfile', '.dockerignore', '.github/workflows/'],
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
  //
  // The backend is exempt because it has no Vercel project to set that variable: it runs from a
  // GitHub Actions workflow, where the branch pin is the workflow's own `on: push: branches:`.
  // Without the exemption every CI run would read an unset VERCEL_ENV and silently skip forever.
  if (app !== 'backend' && process.env.VERCEL_ENV !== 'production') return SKIP;

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
    for (const app of ['admin', 'web', 'lp', 'landing', 'backend']) {
      assert.equal(shouldBuild(app, changed), expected[app], `${app}: ${why} — ${JSON.stringify(changed)}`);
    }
  };
  const all = { admin: true, web: true, lp: true, landing: true, backend: true };
  const none = { admin: false, web: false, lp: false, landing: false, backend: false };

  // The push that prompted this file: two docs files inside an app directory.
  t(['monorepo/apps/admin/README.md', 'monorepo/apps/admin/.env.example'], none, 'docs in an app dir deploy nothing');
  t(['monorepo/apps/admin/next.config.ts'], { ...none, admin: true }, 'app code wakes only its own app');
  // Shared is the one scope the backend has in common with the frontends — it is the wire contract.
  t(['monorepo/packages/shared/src/units.ts'], { admin: true, web: true, lp: true, landing: false, backend: true }, 'landing skips shared');
  // The design system is shared by exactly the two apps that render the product's own UI.
  t(['monorepo/packages/ui/src/primitives.tsx'], { admin: false, web: true, lp: true, landing: false, backend: false }, 'ui wakes web + lp only');
  t(['monorepo/apps/lp/src/app/page.tsx'], { ...none, lp: true }, 'lp code wakes only lp');
  t(['monorepo/yarn.lock'], all, 'a dependency change can move any output');
  t(['monorepo/docs/01-architecture.md'], none, 'docs/ is outside every scope');
  t(['monorepo/DEPLOY.md'], none, 'so are the runbooks');
  t(['monorepo/apps/backend/src/routes/auth.ts'], { ...none, backend: true }, 'backend code wakes Railway, never Vercel');
  // The build files sit at the GIT root, beside monorepo/ — a change to either rebuilds the image
  // without touching backend source, and must reach nothing else.
  t(['Dockerfile'], { ...none, backend: true }, 'the image recipe wakes only the image');
  t(['.dockerignore'], { ...none, backend: true }, 'so does what the image excludes');
  t(['.github/workflows/backend-image.yml'], { ...none, backend: true }, 'and so does the workflow that deploys it');
  // Mixed: docs are dropped first, then what remains decides.
  t(['monorepo/apps/web/README.md', 'monorepo/apps/web/src/app/page.tsx'], { ...none, web: true }, 'code beside docs');
  // A typo in the wiring must not silently mute a project.
  assert.equal(shouldBuild('addmin', ['monorepo/apps/admin/README.md']), true, 'unknown app builds');

  console.log('vercel-ignore: OK — 14 cases across 5 targets, docs never deploy, unknowns always build');
} else {
  process.exit(main(process.argv[2]));
}
