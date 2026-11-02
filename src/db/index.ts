/**
 * The one place that opens the database.
 *
 * `expo-sqlite` is imported here and nowhere else: `queries.ts`, `migrations.ts`
 * and everything under `domain/` talk to the structural `QueryableDatabase`
 * interface, which is what lets the real schema and the real write path run
 * under `node:sqlite` in tests.
 */

import * as SQLite from 'expo-sqlite';
import seedData from '../../assets/exercise-seed.json';
import { migrate } from './migrations';
import { seedExercises, type SeedExercise } from './seed';
import type { QueryableDatabase } from './queries';

export const DATABASE_NAME = 'gym-tracker.db';

let opened: Promise<QueryableDatabase> | null = null;

/**
 * Opens the database, applies pragmas, runs migrations, seeds the library.
 *
 * - **WAL** so a read during a write does not block the logging screen.
 * - **foreign_keys = ON** — SQLite defaults it OFF per connection, and the
 *   session→set cascade in SPEC.md is not optional.
 * - One connection, memoised: `expo-sqlite` serialises writes on it, which is
 *   the serialisation SPEC.md asks for.
 */
export function openDatabase(): Promise<QueryableDatabase> {
  opened ??= (async () => {
    const db = (await SQLite.openDatabaseAsync(DATABASE_NAME)) as unknown as QueryableDatabase;
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await migrate(db);
    // Idempotent: inserts what is missing and touches nothing else, so a
    // library update on a later release lands without a migration.
    await seedExercises(db, seedData as SeedExercise[]);
    return db;
  })();
  return opened;
}
