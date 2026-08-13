// tier.ts — enforcement for migration 0013: refuse to run against another tier's database.
//
// Rationale and the incident that prompted it are in 0013_deployment_tier.sql. The short version:
// prod was pointed at the stage database, served traffic against it, and the only symptom was a
// user reporting their account had no rows.
//
// Split of duties, deliberate:
//   db:deploy  verifies, migrates, then CLAIMS — an unstamped database is a legitimately fresh one,
//              and the deploy path is the only place that already holds the migration advisory lock.
//   server     verifies ONLY. A booting process must never quietly adopt a database that nothing
//              migrated; if the stamp is missing there, the right answer is to run db:deploy.
import { config } from '../envConfig';

import { getPool } from './pool';

export type DeploymentTier = 'production' | 'development';

/** Local and stage share one database by design, so the boundary is production vs everything else. */
export const expectedTier = (): DeploymentTier => (config.isProduction ? 'production' : 'development');

/** Host only — never credentials, same rule as envConfig's boot banner. */
function dbHost(): string {
  try {
    return new URL(config.databaseUrl!).hostname;
  } catch {
    return '(unparseable)';
  }
}

/** The stamp, or undefined on a database that predates 0013 (or has not been migrated yet). */
async function readOwner(): Promise<DeploymentTier | undefined> {
  try {
    const { rows } = await getPool().query<{ tier: DeploymentTier }>('select tier from deployment_tier limit 1');
    return rows[0]?.tier;
  } catch (e) {
    // 42P01 undefined_table — the migration has not run here yet. Not an error: db:deploy is about
    // to create it, and the server has nothing to verify against.
    if ((e as { code?: string }).code === '42P01') return undefined;
    throw e;
  }
}

/**
 * Throw unless this database belongs to the running tier.
 *
 * `claim` stamps an unstamped database for the current tier — pass it only from the migration path,
 * and only after the migrations have actually applied.
 */
export async function assertDatabaseTier({ claim = false } = {}): Promise<void> {
  const want = expectedTier();
  const owner = await readOwner();

  if (!owner) {
    if (!claim) return;
    await getPool().query(
      `insert into deployment_tier (tier) values ($1) on conflict (singleton) do nothing`,
      [want],
    );
    console.log(`[tier] claimed ${dbHost()} for '${want}'`);
    return;
  }

  if (owner !== want) {
    // Name both sides and the host: the whole cost of the original incident was that the wrong
    // database looked exactly like the right one.
    throw new Error(
      `refusing to run against the wrong tier's database — NODE_ENV=${config.nodeEnv} expects ` +
        `'${want}', but ${dbHost()} is stamped '${owner}'. Fix the connection string ` +
        `(${config.isProduction ? 'DATABASE_URL' : 'STAGE_DATABASE_URL'}), not this check.`,
    );
  }
}
