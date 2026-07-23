// One-shot schema loader: `yarn workspace @fpay/backend db:init` (needs DATABASE_URL).
// `--drop` (aka db:reset) wipes the whole public schema first — full fresh-start sequence:
//   db:reset → db:seed → devnet:setup (then copy the printed USDC_MINT + FEE_PAYER_SECRET_KEY
//   into .env; web users re-appear on next login via /auth/sync).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from './pool';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  const pool = getPool();
  if (process.argv.includes('--drop')) {
    await pool.query('drop schema public cascade; create schema public;');
    console.log('Dropped schema public.');
  }
  await pool.query(sql);
  console.log('Schema applied.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
