/**
 * Migration runner.
 *
 * Versioning uses SQLite's own `user_version` pragma rather than a metadata
 * table: it is atomic with the migration transaction and needs no bootstrap
 * step. Migrations run in order, each inside a transaction, and the runner
 * refuses to open a database newer than the code — a build that does not know
 * about a column must not write to it.
 *
 * Forward-only, one migration per release (SPEC.md). There are no down
 * migrations; a mistake is corrected by a new forward migration.
 */

import { ADD_ROUTINE_IMPORT_BATCH, ALL_DDL, SCHEMA_VERSION } from './schema';

/**
 * The slice of `expo-sqlite`'s async database this module needs.
 *
 * Declared structurally so the runner can be exercised against any driver with
 * the same shape — `expo-sqlite` on device, `node:sqlite` in a test.
 */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
}

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(db: SqlDatabase): Promise<void>;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    async up(db) {
      for (const stmt of ALL_DDL) {
        await db.execAsync(stmt);
      }
    },
  },
  {
    version: 2,
    name: 'routines know which import made them',
    async up(db) {
      // Additive, so no table rewrite and nothing to back up: undo needs to
      // remove its own routines and only those.
      await db.execAsync(ADD_ROUTINE_IMPORT_BATCH);
    },
  },
];

export class SchemaDowngradeError extends Error {}

async function userVersion(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  return row?.user_version ?? 0;
}

/**
 * Applies every migration newer than the database's `user_version`.
 *
 * Each migration commits with its own version bump, so an interrupted run
 * resumes at the right place rather than replaying work already committed.
 * Returns the version the database is left at.
 */
export async function migrate(db: SqlDatabase): Promise<number> {
  const current = await userVersion(db);

  if (current > SCHEMA_VERSION) {
    throw new SchemaDowngradeError(
      `database is at version ${current}, this build understands ${SCHEMA_VERSION}`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;

    await db.execAsync('BEGIN;');
    try {
      await migration.up(db);
      // PRAGMA takes no bound parameters, hence the interpolation. The value is
      // a number literal from MIGRATIONS, never user input.
      await db.execAsync(`PRAGMA user_version = ${migration.version};`);
      await db.execAsync('COMMIT;');
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
  }

  return userVersion(db);
}
