import pg from 'pg';

import { config } from '../config';

// Railway provides DATABASE_URL. The pool is created lazily so the server can boot
// (and serve /health + the stubbed routes) before a database is attached.
let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set — attach a Railway Postgres plugin and set the env var.');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      // Railway Postgres typically requires SSL; relax verification for the managed cert.
      ssl: config.pgSslDisable ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export const hasDatabase = () => Boolean(config.databaseUrl);
