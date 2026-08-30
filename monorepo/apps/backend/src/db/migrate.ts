// migrate.ts — CLI for the migration runner (yarn db:migrate / db:status / db:deploy / db:new /
// db:reset). `deploy` is the same apply as `migrate`; it exists as a named intent for hosts — the
// image's CMD (repo-root Dockerfile) runs it before `start`, so a deploy can never boot against a
// stale schema. There is no host-side start command to look for; the CMD is it. Which DB
// is being touched is printed by the config banner at import time (NODE_ENV tier chain).
// Full fresh-start sequence is unchanged: db:reset → db:seed.
// USDC_MINT + FEE_PAYER_SECRET_KEY into .env; web users re-appear on next login via /auth/sync).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../envConfig';

import { applyPending, listMigrationFiles, migrationStatus } from './migrations';
import { getPool } from './pool';
import { assertDatabaseTier } from './tier';

const cmd = process.argv[2] ?? 'migrate';

async function main() {
  switch (cmd) {
    case 'migrate':
    case 'deploy': {
      // Before anything is written: this must be OUR database (0013). Prod once ran a full deploy
      // against the stage database and the only sign was a user with no rows.
      await assertDatabaseTier();
      const applied = await applyPending();
      // After: a database that had no stamp is a fresh one, and this is the only path allowed to
      // claim it — the server verifies but never adopts.
      await assertDatabaseTier({ claim: true });
      console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Migrations up to date.');
      break;
    }

    case 'status': {
      const { lines, warnings } = await migrationStatus();
      for (const l of lines) console.log(l);
      for (const w of warnings) console.warn(`WARNING: ${w}`);
      break;
    }

    case 'new': {
      const name = (process.argv[3] ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!name) throw new Error('usage: yarn db:new <name>');
      const files = listMigrationFiles();
      const next = String(Number(files.at(-1)?.version ?? '0') + 1).padStart(4, '0');
      const file = join(dirname(fileURLToPath(import.meta.url)), 'migrations', `${next}_${name}.sql`);
      writeFileSync(file, `-- ${next}_${name}\n-- Runs once, inside a transaction. Forward-only: to undo, write another migration.\n`);
      console.log(`Created ${file}`);
      return; // no DB touched
    }

    case 'reset': {
      if (config.isProduction) throw new Error('db:reset refuses to run against production.');
      await getPool().query('drop schema public cascade; create schema public;');
      console.log('Dropped schema public.');
      const applied = await applyPending();
      // The drop took the stamp with it, so re-claim for whichever tier just reset.
      await assertDatabaseTier({ claim: true });
      console.log(`Applied ${applied.length} migration(s).`);
      break;
    }

    default:
      throw new Error(`unknown command '${cmd}' — expected migrate | deploy | status | new <name> | reset`);
  }
  await getPool().end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
