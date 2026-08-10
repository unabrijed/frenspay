import pg from 'pg';

import { config } from '../envConfig';

// Railway provides DATABASE_URL. Pools are created lazily so the server can boot
// (and serve /health + the stubbed routes) before a database is attached.
let pool: pg.Pool | null = null;
let lockPool: pg.Pool | null = null;

function makePool(max: number): pg.Pool {
  return new pg.Pool({
    connectionString: config.databaseUrl!,
    // Railway Postgres typically requires SSL; relax verification for the managed cert.
    ssl: config.pgSslDisable ? false : { rejectUnauthorized: false },
    max,
    // Fail fast on exhaustion instead of waiting forever (the default), so a bad state surfaces as a
    // 503 rather than a silent hang.
    connectionTimeoutMillis: 10_000,
  });
}

export function getPool(): pg.Pool {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set — attach a Railway Postgres plugin and set the env var.');
  }
  if (!pool) pool = makePool(12);
  return pool;
}

// Dedicated pool for advisory locks (withUserLock). Kept SEPARATE from the query pool: a lock-holding
// connection is held across the whole critical section (incl. an RPC), and the queries that run *inside*
// that section draw from the query pool — so they can never starve each other into a pool deadlock
// (M6 audit H1). Sized for concurrent lock-holders; the section is short, so a small pool suffices.
export function getLockPool(): pg.Pool {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set — attach a Railway Postgres plugin and set the env var.');
  }
  if (!lockPool) lockPool = makePool(6);
  return lockPool;
}

export const hasDatabase = () => Boolean(config.databaseUrl);
