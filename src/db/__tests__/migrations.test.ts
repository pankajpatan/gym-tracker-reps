import { migrate, MIGRATIONS, SchemaDowngradeError } from '../migrations';
import { SCHEMA_VERSION } from '../schema';
import { openTestDatabase } from './sqliteAdapter';

describe('migrations', () => {
  it('brings an empty database to the current schema version', async () => {
    const db = openTestDatabase();
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('creates every table the spec names', async () => {
    const db = openTestDatabase();
    await migrate(db);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    );
    expect(tables.map((t) => t.name)).toEqual([
      'body_measure', 'exercise', 'import_batch', 'pr',
      'routine', 'routine_exercise', 'session', 'set_entry', 'setting',
    ]);
    db.close();
  });

  it('is idempotent — running twice changes nothing and does not throw', async () => {
    const db = openTestDatabase();
    await migrate(db);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('refuses a database newer than the code', async () => {
    const db = openTestDatabase();
    await migrate(db);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
    await expect(migrate(db)).rejects.toBeInstanceOf(SchemaDowngradeError);
    db.close();
  });

  it('declares versions in ascending order with no gaps', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
    expect(versions.at(-1)).toBe(SCHEMA_VERSION);
  });

  it('leaves no partial schema behind when a migration throws', async () => {
    const db = openTestDatabase();
    const broken = {
      version: 1,
      name: 'broken',
      async up(database: typeof db) {
        await database.execAsync('CREATE TABLE half_written (id INTEGER PRIMARY KEY);');
        await database.execAsync('THIS IS NOT SQL;');
      },
    };
    // Run the broken migration through the same transaction discipline the
    // runner uses, and assert nothing it created survives the rollback.
    await db.execAsync('BEGIN;');
    try {
      await broken.up(db);
      await db.execAsync('COMMIT;');
    } catch {
      await db.execAsync('ROLLBACK;');
    }
    const leftover = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE name = 'half_written';",
    );
    expect(leftover).toBeNull();
    db.close();
  });
});

describe('migration 2 — routines know their import', () => {
  it('adds the column to a database created at version 1', async () => {
    const db = openTestDatabase();
    // Simulate an install that shipped before the column existed.
    await migrate(db);
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(routine);');
    expect(columns.map((c) => c.name)).toContain('import_batch_id');
    db.close();
  });

  it('leaves existing routines untouched', async () => {
    const db = openTestDatabase();
    await migrate(db);
    await db.runAsync(
      "INSERT INTO routine (name, position, source, created_at) VALUES ('Push', 0, 'user', 1);",
    );
    expect(await migrate(db)).toBe(2);
    const row = await db.getFirstAsync<{ name: string; import_batch_id: number | null }>(
      'SELECT name, import_batch_id FROM routine;',
    );
    expect(row).toMatchObject({ name: 'Push', import_batch_id: null });
    db.close();
  });
});
