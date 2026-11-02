/**
 * A `QueryableDatabase` backed by Node's built-in SQLite, for tests only.
 *
 * The db layer talks to a structural interface rather than to `expo-sqlite`
 * directly, so the real schema, the real migration runner and the real
 * constraints are exercised in-process against the same engine that ships on
 * the device. Nothing here is imported by app code.
 */

import { DatabaseSync } from 'node:sqlite';
import type { QueryableDatabase } from '../queries';

export function openTestDatabase(): QueryableDatabase & { close(): void } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    async execAsync(sql: string): Promise<void> {
      db.exec(sql);
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const row = db.prepare(sql).get(...(params as never[]));
      return (row as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async runAsync(sql: string, ...params: unknown[]): Promise<unknown> {
      const result = db.prepare(sql).run(...(params as never[]));
      return { lastInsertRowId: Number(result.lastInsertRowid) };
    },
    close(): void {
      db.close();
    },
  };
}
