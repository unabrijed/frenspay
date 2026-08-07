// migrations.ts — in-house forward-only migration runner (no deps, same spirit as the rate limiter).
// Files live in ./migrations as NNNN_name.sql, applied in filename order, tracked in
// schema_migrations by version + md5 checksum. Each file runs inside its own transaction, so
// `create index concurrently` cannot appear in a migration; if that's ever needed, it gets its own
// non-transactional escape hatch. Serialized across concurrent runners (two deploys, deploy + local)
// with a pg advisory lock, same shape as withUserLock in queries.ts.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from './pool';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 'fpay:migrations';

const TRACKING_TABLE = `
  create table if not exists schema_migrations (
    version    text primary key,
    name       text not null,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )`;

export interface MigrationFile {
  version: string; // '0001'
  name: string; // 'baseline'
  file: string; // absolute path
  checksum: string;
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

export function listMigrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      version: f.slice(0, 4),
      name: f.slice(5, -4),
      file: join(MIGRATIONS_DIR, f),
      checksum: createHash('md5').update(readFileSync(join(MIGRATIONS_DIR, f))).digest('hex'),
    }));
}

async function appliedRows(): Promise<AppliedRow[]> {
  const pool = getPool();
  await pool.query(TRACKING_TABLE);
  const { rows } = await pool.query<AppliedRow>('select * from schema_migrations order by version');
  return rows;
}

/** Files on disk not yet recorded in schema_migrations. Creates the tracking table if missing. */
export async function pendingMigrations(): Promise<MigrationFile[]> {
  const done = new Set((await appliedRows()).map((r) => r.version));
  return listMigrationFiles().filter((m) => !done.has(m.version));
}

/** Apply every pending migration in order. Returns the versions applied. */
export async function applyPending(log: (msg: string) => void = console.log): Promise<string[]> {
  const pending = await pendingMigrations();
  if (!pending.length) return [];
  // Dedicated client for the advisory lock: the lock is session-scoped, so it must live and die on
  // one connection, not bounce around the pool.
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    // Re-read under the lock — a concurrent runner may have applied some while we waited.
    const done = new Set((await appliedRows()).map((r) => r.version));
    for (const m of pending.filter((p) => !done.has(p.version))) {
      log(`applying ${m.version}_${m.name}…`);
      try {
        await client.query('begin');
        await client.query(readFileSync(m.file, 'utf8'));
        await client.query('insert into schema_migrations (version, name, checksum) values ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`migration ${m.version}_${m.name} failed (rolled back): ${(err as Error).message}`);
      }
      applied.push(m.version);
    }
    await client.query('select pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
  } catch (err) {
    // Unlock may be unreachable (dead connection) — destroying the client releases it server-side.
    client.release(true);
    throw err;
  }
  client.release();
  return applied;
}

/** Status lines for the CLI + drift warnings (file edited after apply, applied file deleted). */
export async function migrationStatus(): Promise<{ lines: string[]; warnings: string[] }> {
  const files = listMigrationFiles();
  const rows = await appliedRows();
  const byVersion = new Map(rows.map((r) => [r.version, r]));
  const lines = files.map((m) => {
    const row = byVersion.get(m.version);
    return `${m.version}_${m.name}  ${row ? `applied ${row.applied_at.toISOString()}` : 'PENDING'}`;
  });
  const warnings: string[] = [];
  for (const m of files) {
    const row = byVersion.get(m.version);
    if (row && row.checksum !== m.checksum) {
      warnings.push(`${m.version}_${m.name} was EDITED after being applied — put the change in a new migration instead`);
    }
  }
  const onDisk = new Set(files.map((m) => m.version));
  for (const r of rows) {
    if (!onDisk.has(r.version)) warnings.push(`${r.version}_${r.name} is applied but its file is missing`);
  }
  return { lines, warnings };
}
