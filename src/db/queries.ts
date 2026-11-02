/**
 * The write path (SPEC.md F-4).
 *
 * The rule this module exists to enforce: **the active session lives in SQLite
 * from the moment it starts.** Nothing is held in memory waiting to be flushed,
 * so a force-quit mid-session loses nothing — the UI re-reads the open session
 * on launch and carries on. Every function here commits before it returns.
 */

import type { SqlDatabase } from './migrations';
import { normaliseName } from '../domain/normalise';
import {
  personalRecords,
  type E1rmFormula,
  type PrRow,
  type SetRow,
  type SetType,
} from '../domain/derive';

export interface QueryableDatabase extends SqlDatabase {
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

interface InsertResult {
  readonly lastInsertRowId: number;
}

function insertedId(result: unknown): number {
  const id = (result as InsertResult | undefined)?.lastInsertRowId;
  if (typeof id !== 'number') {
    throw new Error('driver did not report lastInsertRowId');
  }
  return id;
}

/** Epoch seconds, UTC — the only time unit stored anywhere (SPEC.md). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------- exercises

export interface NewExercise {
  readonly name: string;
  readonly muscle?: string | null;
  readonly equipment?: string | null;
  readonly instructions?: string | null;
  readonly artRef?: string | null;
  readonly isCustom?: boolean;
}

export async function insertExercise(
  db: QueryableDatabase,
  exercise: NewExercise,
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO exercise (name, name_norm, muscle, equipment, instructions, art_ref, is_custom)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    exercise.name,
    normaliseName(exercise.name),
    exercise.muscle ?? null,
    exercise.equipment ?? null,
    exercise.instructions ?? null,
    exercise.artRef ?? null,
    exercise.isCustom ? 1 : 0,
  );
  return insertedId(result);
}

export async function findExerciseByName(
  db: QueryableDatabase,
  name: string,
): Promise<{ id: number; name: string } | null> {
  return db.getFirstAsync<{ id: number; name: string }>(
    'SELECT id, name FROM exercise WHERE name_norm = ?;',
    normaliseName(name),
  );
}

// ----------------------------------------------------------------- sessions

/**
 * Starts a session and returns its id. The row exists before the user logs
 * anything, which is what makes the session resumable.
 */
export async function startSession(
  db: QueryableDatabase,
  options: { routineId?: number | null; name?: string | null; startedAt?: number } = {},
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO session (routine_id, name, started_at) VALUES (?, ?, ?);',
    options.routineId ?? null,
    options.name ?? null,
    options.startedAt ?? nowSeconds(),
  );
  return insertedId(result);
}

/**
 * The open session, if there is one.
 *
 * `ended_at IS NULL` is the definition of "active". More than one open session
 * is not a state the UI can create; if it somehow exists, the most recent wins
 * rather than the query failing.
 */
export async function activeSession(
  db: QueryableDatabase,
): Promise<{ id: number; started_at: number; name: string | null } | null> {
  return db.getFirstAsync(
    `SELECT id, started_at, name FROM session
     WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1;`,
  );
}

export interface NewSet {
  readonly sessionId: number;
  readonly exerciseId: number;
  readonly position: number;
  readonly weightKg?: number | null;
  readonly reps?: number | null;
  readonly durationS?: number | null;
  readonly distanceM?: number | null;
  readonly type?: SetType;
  readonly rpe?: number | null;
  readonly note?: string | null;
  readonly supersetGroup?: number | null;
  readonly doneAt?: number | null;
}

/**
 * One set, one INSERT, committed before the caller marks the row done in the
 * UI. There is no batching and no optimistic-only state: if this resolves, the
 * set is on disk.
 *
 * The `ck_set_measured` constraint rejects a set carrying no measurement at
 * all; that surfaces here as a driver error rather than a silent empty row.
 */
export async function logSet(db: QueryableDatabase, set: NewSet): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO set_entry
       (session_id, exercise_id, position, superset_group,
        weight_kg, reps, duration_s, distance_m, type, rpe, note, done_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    set.sessionId,
    set.exerciseId,
    set.position,
    set.supersetGroup ?? null,
    set.weightKg ?? null,
    set.reps ?? null,
    set.durationS ?? null,
    set.distanceM ?? null,
    set.type ?? 'normal',
    set.rpe ?? null,
    set.note ?? null,
    set.doneAt ?? nowSeconds(),
  );
  return insertedId(result);
}

export async function setsForSession(
  db: QueryableDatabase,
  sessionId: number,
): Promise<SetRow[]> {
  return db.getAllAsync<SetRow>(
    `SELECT id, exercise_id, weight_kg, reps, type, done_at
     FROM set_entry WHERE session_id = ? ORDER BY position, id;`,
    sessionId,
  );
}

async function setsForExercise(
  db: QueryableDatabase,
  exerciseId: number,
): Promise<SetRow[]> {
  return db.getAllAsync<SetRow>(
    `SELECT id, exercise_id, weight_kg, reps, type, done_at
     FROM set_entry WHERE exercise_id = ? ORDER BY done_at, id;`,
    exerciseId,
  );
}

/**
 * Recomputes `pr` for one exercise from its complete set history.
 *
 * Recompute-from-history rather than compare-and-update, because the same
 * routine has to serve three callers that can all *lower* a record: finishing a
 * session, deleting one, and undoing an import. A comparison would only ever
 * ratchet upward and would leave a deleted session's record standing.
 */
export async function recomputePrs(
  db: QueryableDatabase,
  exerciseId: number,
  formula: E1rmFormula = 'epley',
): Promise<PrRow[]> {
  const history = await setsForExercise(db, exerciseId);
  const records = personalRecords(exerciseId, history, formula);

  await db.runAsync('DELETE FROM pr WHERE exercise_id = ?;', exerciseId);
  for (const record of records) {
    await db.runAsync(
      `INSERT INTO pr (exercise_id, kind, value, set_id, achieved_at)
       VALUES (?, ?, ?, ?, ?);`,
      record.exercise_id,
      record.kind,
      record.value,
      record.set_id,
      record.achieved_at,
    );
  }
  return records;
}

async function exerciseIdsInSession(
  db: QueryableDatabase,
  sessionId: number,
): Promise<number[]> {
  const rows = await db.getAllAsync<{ exercise_id: number }>(
    'SELECT DISTINCT exercise_id FROM set_entry WHERE session_id = ?;',
    sessionId,
  );
  return rows.map((row) => row.exercise_id);
}

/**
 * Ends a session and recomputes records for every exercise it touched.
 *
 * Ending and recomputing share one transaction: a session that is marked
 * finished but whose records never landed would show a stale PR on the very
 * screen the user opens next.
 */
export async function finishSession(
  db: QueryableDatabase,
  sessionId: number,
  options: { endedAt?: number; formula?: E1rmFormula } = {},
): Promise<void> {
  const touched = await exerciseIdsInSession(db, sessionId);

  await db.execAsync('BEGIN;');
  try {
    await db.runAsync(
      'UPDATE session SET ended_at = ? WHERE id = ?;',
      options.endedAt ?? nowSeconds(),
      sessionId,
    );
    for (const exerciseId of touched) {
      await recomputePrs(db, exerciseId, options.formula ?? 'epley');
    }
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

/**
 * Deletes a session, its sets (by cascade) and recomputes the records it may
 * have been holding. Requires `PRAGMA foreign_keys = ON`, which `openDatabase`
 * sets — SQLite's default is OFF and the cascade would silently not happen.
 */
export async function deleteSession(
  db: QueryableDatabase,
  sessionId: number,
  formula: E1rmFormula = 'epley',
): Promise<void> {
  const touched = await exerciseIdsInSession(db, sessionId);

  await db.execAsync('BEGIN;');
  try {
    await db.runAsync('DELETE FROM session WHERE id = ?;', sessionId);
    for (const exerciseId of touched) {
      await recomputePrs(db, exerciseId, formula);
    }
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

// ----------------------------------------------------------------- settings

export async function getSetting(
  db: QueryableDatabase,
  key: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM setting WHERE key = ?;',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: QueryableDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO setting (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    key,
    value,
  );
}

/**
 * The PREVIOUS column (UI.md §3): the same set index from the last session that
 * contained this exercise.
 *
 * "Last session" is the most recent *finished* one — an open session is the one
 * being logged right now, and showing its own rows back as the target to beat
 * would be circular.
 */
export async function previousSetsForExercise(
  db: QueryableDatabase,
  exerciseId: number,
): Promise<{ weightKg: number | null; reps: number | null }[]> {
  const last = await db.getFirstAsync<{ session_id: number }>(
    `SELECT s.id AS session_id
     FROM session s
     JOIN set_entry e ON e.session_id = s.id
     WHERE e.exercise_id = ? AND s.ended_at IS NOT NULL
     ORDER BY s.started_at DESC LIMIT 1;`,
    exerciseId,
  );
  if (!last) return [];

  const rows = await db.getAllAsync<{ weight_kg: number | null; reps: number | null }>(
    `SELECT weight_kg, reps FROM set_entry
     WHERE session_id = ? AND exercise_id = ? AND type != 'warmup'
     ORDER BY position, id;`,
    last.session_id,
    exerciseId,
  );
  return rows.map((row) => ({ weightKg: row.weight_kg, reps: row.reps }));
}

// -------------------------------------------------------- library (F-9)

export interface LibraryRow {
  readonly id: number;
  readonly name: string;
  readonly muscle: string | null;
  readonly equipment: string | null;
  readonly is_custom: number;
  readonly art_ref: string | null;
}

/**
 * The exercise picker (UI.md §5.2): search-first, archived rows hidden.
 *
 * Every word must appear, **in any order**. A single contiguous LIKE fails the
 * case that matters most here: the library writes `Barbell Bench Press - Medium
 * Grip` and the lifter types "bench press barbell". That is the same
 * word-order mismatch that sank the old ≥0.9 matcher (MATCHING.md), and it
 * would have made the picker look empty for the most common search in the app.
 *
 * Ordering puts the shortest name first, so the plain movement leads its own
 * variants instead of being buried under them.
 */
export async function searchExercises(
  db: QueryableDatabase,
  query = '',
  limit = 200,
): Promise<LibraryRow[]> {
  const words = normaliseName(query).split(' ').filter(Boolean);
  if (words.length === 0) {
    return db.getAllAsync<LibraryRow>(
      `SELECT id, name, muscle, equipment, is_custom, art_ref FROM exercise
       WHERE archived = 0 ORDER BY name LIMIT ?;`,
      limit,
    );
  }
  const clauses = words.map(() => 'name_norm LIKE ?').join(' AND ');
  return db.getAllAsync<LibraryRow>(
    `SELECT id, name, muscle, equipment, is_custom, art_ref FROM exercise
     WHERE archived = 0 AND ${clauses} ORDER BY length(name), name LIMIT ?;`,
    ...words.map((word) => `%${word}%`),
    limit,
  );
}

export async function createCustomExercise(
  db: QueryableDatabase,
  exercise: { name: string; muscle?: string | null; equipment?: string | null; instructions?: string | null },
): Promise<number> {
  return insertExercise(db, { ...exercise, isCustom: true });
}

/**
 * Editing a seeded exercise clones it (SPEC.md F-9).
 *
 * The seed row is archived rather than deleted: sets already logged against it
 * point at its id, and re-pointing them would rewrite history to make a rename
 * look like it was always there. Archiving hides it from the picker and leaves
 * the past intact.
 */
export async function editExercise(
  db: QueryableDatabase,
  id: number,
  changes: { name?: string; muscle?: string | null; equipment?: string | null; instructions?: string | null },
): Promise<number> {
  const row = await db.getFirstAsync<LibraryRow & { instructions: string | null }>(
    'SELECT id, name, muscle, equipment, instructions, is_custom, art_ref FROM exercise WHERE id = ?;',
    id,
  );
  if (!row) throw new Error(`no exercise ${id}`);

  const next = {
    name: changes.name ?? row.name,
    muscle: changes.muscle !== undefined ? changes.muscle : row.muscle,
    equipment: changes.equipment !== undefined ? changes.equipment : row.equipment,
    instructions: changes.instructions !== undefined ? changes.instructions : row.instructions,
  };

  if (row.is_custom === 1) {
    await db.runAsync(
      `UPDATE exercise SET name = ?, name_norm = ?, muscle = ?, equipment = ?, instructions = ?
       WHERE id = ?;`,
      next.name, normaliseName(next.name), next.muscle, next.equipment, next.instructions, id,
    );
    return id;
  }

  const clone = await db.runAsync(
    `INSERT INTO exercise (name, name_norm, muscle, equipment, instructions, art_ref, is_custom)
     VALUES (?, ?, ?, ?, ?, ?, 1);`,
    next.name, normaliseName(next.name), next.muscle, next.equipment, next.instructions, row.art_ref,
  );
  await db.runAsync('UPDATE exercise SET archived = 1 WHERE id = ?;', id);
  return insertedId(clone);
}

/** Names and muscles for a set of exercise ids — used to rebuild a session. */
export async function exercisesByIds(
  db: QueryableDatabase,
  ids: readonly number[],
): Promise<Map<number, { id: number; name: string; muscle: string | null; equipment: string | null }>> {
  const out = new Map<number, { id: number; name: string; muscle: string | null; equipment: string | null }>();
  if (ids.length === 0) return out;
  const holes = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ id: number; name: string; muscle: string | null; equipment: string | null }>(
    `SELECT id, name, muscle, equipment FROM exercise WHERE id IN (${holes});`,
    ...ids,
  );
  for (const row of rows) out.set(row.id, row);
  return out;
}

// ------------------------------------------------------------ routines (F-1)

export interface RoutineRow {
  readonly id: number;
  readonly name: string;
  readonly position: number;
  readonly source: string | null;
  readonly created_at: number;
}

export interface RoutineExerciseRow {
  readonly id: number;
  readonly exercise_id: number;
  readonly name: string;
  readonly muscle: string | null;
  readonly equipment: string | null;
  readonly position: number;
  readonly target_sets: number | null;
  readonly rest_s: number | null;
  readonly superset_group: number | null;
}

/**
 * Creates a routine at the end of the list.
 *
 * **There is no cap, ever**, so nothing here counts routines.
 */
export async function createRoutine(
  db: QueryableDatabase,
  name: string,
  source: 'user' | 'import' = 'user',
  importBatchId: number | null = null,
): Promise<number> {
  const last = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM routine;',
  );
  const result = await db.runAsync(
    `INSERT INTO routine (name, position, source, created_at, import_batch_id)
     VALUES (?, ?, ?, ?, ?);`,
    name, last?.next ?? 0, source, nowSeconds(), importBatchId,
  );
  return insertedId(result);
}

export async function listRoutines(db: QueryableDatabase): Promise<RoutineRow[]> {
  return db.getAllAsync<RoutineRow>(
    'SELECT id, name, position, source, created_at FROM routine ORDER BY position, id;',
  );
}

export async function addExerciseToRoutine(
  db: QueryableDatabase,
  routineId: number,
  exerciseId: number,
  options: { targetSets?: number | null; restS?: number | null; supersetGroup?: number | null } = {},
): Promise<number> {
  const last = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM routine_exercise WHERE routine_id = ?;',
    routineId,
  );
  const result = await db.runAsync(
    `INSERT INTO routine_exercise
       (routine_id, exercise_id, position, target_sets, rest_s, superset_group)
     VALUES (?, ?, ?, ?, ?, ?);`,
    routineId, exerciseId, last?.next ?? 0,
    options.targetSets ?? null, options.restS ?? null, options.supersetGroup ?? null,
  );
  return insertedId(result);
}

export async function routineExercises(
  db: QueryableDatabase,
  routineId: number,
): Promise<RoutineExerciseRow[]> {
  return db.getAllAsync<RoutineExerciseRow>(
    `SELECT re.id, re.exercise_id, e.name, e.muscle, e.equipment, re.position,
            re.target_sets, re.rest_s, re.superset_group
     FROM routine_exercise re
     JOIN exercise e ON e.id = re.exercise_id
     WHERE re.routine_id = ?
     ORDER BY re.position, re.id;`,
    routineId,
  );
}

/**
 * Reorders a routine by rewriting every position from the given order.
 *
 * Rewriting all of them rather than swapping two keeps positions dense and
 * gap-free, so a drag that lands anywhere produces the same shape as any other.
 * Ids not in the list are left alone — a partial list is a caller bug, not a
 * reason to renumber rows the caller did not mention.
 */
export async function reorderRoutineExercises(
  db: QueryableDatabase,
  routineId: number,
  orderedIds: readonly number[],
): Promise<void> {
  await db.execAsync('BEGIN;');
  try {
    for (const [index, id] of orderedIds.entries()) {
      await db.runAsync(
        'UPDATE routine_exercise SET position = ? WHERE id = ? AND routine_id = ?;',
        index, id, routineId,
      );
    }
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

export async function updateRoutineExercise(
  db: QueryableDatabase,
  id: number,
  changes: { targetSets?: number | null; restS?: number | null; supersetGroup?: number | null },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (changes.targetSets !== undefined) { sets.push('target_sets = ?'); values.push(changes.targetSets); }
  if (changes.restS !== undefined) { sets.push('rest_s = ?'); values.push(changes.restS); }
  if (changes.supersetGroup !== undefined) { sets.push('superset_group = ?'); values.push(changes.supersetGroup); }
  if (sets.length === 0) return;
  await db.runAsync(`UPDATE routine_exercise SET ${sets.join(', ')} WHERE id = ?;`, ...values, id);
}

export async function removeRoutineExercise(db: QueryableDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM routine_exercise WHERE id = ?;', id);
}

export async function renameRoutine(db: QueryableDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE routine SET name = ? WHERE id = ?;', name, id);
}

/** Deleting a routine leaves past sessions alone — `session.routine_id` goes null. */
export async function deleteRoutine(db: QueryableDatabase, id: number): Promise<void> {
  await db.execAsync('BEGIN;');
  try {
    await db.runAsync('UPDATE session SET routine_id = NULL WHERE routine_id = ?;', id);
    await db.runAsync('DELETE FROM routine WHERE id = ?;', id);
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

/** When this routine was last trained — "Last: 4 days ago" on the card (UI.md §2). */
export async function routineLastTrained(
  db: QueryableDatabase,
  routineId: number,
): Promise<number | null> {
  const row = await db.getFirstAsync<{ started_at: number }>(
    `SELECT started_at FROM session
     WHERE routine_id = ? AND ended_at IS NOT NULL
     ORDER BY started_at DESC LIMIT 1;`,
    routineId,
  );
  return row?.started_at ?? null;
}

// -------------------------------------------------------------- history

export interface SessionSummary {
  readonly id: number;
  readonly name: string | null;
  readonly started_at: number;
  readonly ended_at: number | null;
  readonly sets: number;
  readonly volume_kg: number;
  readonly exercises: number;
}

/**
 * The "Recent" list on the home screen (UI.md §2).
 *
 * Volume excludes warm-ups here exactly as `domain/derive.ts` does — the two
 * must agree, or the number on the history row contradicts the one the lifter
 * watched in the header while training.
 */
export async function recentSessions(
  db: QueryableDatabase,
  limit = 5,
): Promise<SessionSummary[]> {
  return db.getAllAsync<SessionSummary>(
    `SELECT s.id, s.name, s.started_at, s.ended_at,
            COUNT(e.id) AS sets,
            COALESCE(SUM(CASE WHEN e.type != 'warmup'
                              THEN COALESCE(e.weight_kg, 0) * COALESCE(e.reps, 0)
                              ELSE 0 END), 0) AS volume_kg,
            COUNT(DISTINCT e.exercise_id) AS exercises
     FROM session s
     LEFT JOIN set_entry e ON e.session_id = s.id
     WHERE s.ended_at IS NOT NULL
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT ?;`,
    limit,
  );
}

export interface SessionDetailRow {
  readonly exercise_id: number;
  readonly name: string;
  readonly muscle: string | null;
  readonly position: number;
  readonly weight_kg: number | null;
  readonly reps: number | null;
  readonly type: string;
}

/** Every set of one past session, in the order it was logged. */
export async function sessionDetail(
  db: QueryableDatabase,
  sessionId: number,
): Promise<SessionDetailRow[]> {
  return db.getAllAsync<SessionDetailRow>(
    `SELECT e.exercise_id, x.name, x.muscle, e.position, e.weight_kg, e.reps, e.type
     FROM set_entry e
     JOIN exercise x ON x.id = e.exercise_id
     WHERE e.session_id = ?
     ORDER BY e.id;`,
    sessionId,
  );
}

// ------------------------------------------------- exercise detail (F-7)

export interface ExerciseSessionRow {
  readonly session_id: number;
  readonly started_at: number;
  readonly sets: number;
  readonly reps: number;
  readonly volume_kg: number;
  readonly top_weight_kg: number | null;
  readonly best_e1rm: number | null;
}

/**
 * One row per session this exercise appears in, newest first — the History tab
 * and every chart read from this.
 *
 * Warm-ups are excluded throughout: they are not the training being measured,
 * and including them would make a deload week look like a volume record. `e1rm`
 * is computed in SQL with Epley so the chart does not need every set loaded
 * into JavaScript to draw a line.
 */
export async function exerciseHistory(
  db: QueryableDatabase,
  exerciseId: number,
  limit = 200,
): Promise<ExerciseSessionRow[]> {
  return db.getAllAsync<ExerciseSessionRow>(
    `SELECT s.id AS session_id, s.started_at,
            COUNT(e.id) AS sets,
            COALESCE(SUM(e.reps), 0) AS reps,
            COALESCE(SUM(COALESCE(e.weight_kg, 0) * COALESCE(e.reps, 0)), 0) AS volume_kg,
            MAX(e.weight_kg) AS top_weight_kg,
            MAX(CASE WHEN e.weight_kg IS NOT NULL AND e.reps IS NOT NULL AND e.reps > 0
                     THEN e.weight_kg * (1.0 + e.reps / 30.0) END) AS best_e1rm
     FROM set_entry e
     JOIN session s ON s.id = e.session_id
     WHERE e.exercise_id = ? AND e.type != 'warmup' AND s.ended_at IS NOT NULL
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT ?;`,
    exerciseId,
    limit,
  );
}

export interface PrRecord {
  readonly kind: string;
  readonly value: number;
  readonly achieved_at: number;
  readonly set_id: number | null;
}

/** The `pr` table for one exercise — written on session end, never on read. */
export async function personalRecordsFor(
  db: QueryableDatabase,
  exerciseId: number,
): Promise<PrRecord[]> {
  return db.getAllAsync<PrRecord>(
    'SELECT kind, value, achieved_at, set_id FROM pr WHERE exercise_id = ? ORDER BY kind;',
    exerciseId,
  );
}

export interface ExerciseInfo {
  readonly id: number;
  readonly name: string;
  readonly muscle: string | null;
  readonly equipment: string | null;
  readonly instructions: string | null;
  readonly art_ref: string | null;
  readonly is_custom: number;
}

export async function exerciseInfo(
  db: QueryableDatabase,
  exerciseId: number,
): Promise<ExerciseInfo | null> {
  return db.getFirstAsync<ExerciseInfo>(
    `SELECT id, name, muscle, equipment, instructions, art_ref, is_custom
     FROM exercise WHERE id = ?;`,
    exerciseId,
  );
}

/** Days that contain a finished session — the calendar's dots (UI.md §6). */
export async function trainedDays(
  db: QueryableDatabase,
  fromEpoch: number,
  toEpoch: number,
): Promise<{ started_at: number; id: number; name: string | null }[]> {
  return db.getAllAsync(
    `SELECT id, started_at, name FROM session
     WHERE ended_at IS NOT NULL AND started_at >= ? AND started_at < ?
     ORDER BY started_at DESC;`,
    fromEpoch,
    toEpoch,
  );
}

/** Every logged set, flattened for CSV export (F-10). */
export async function allSetsForExport(db: QueryableDatabase): Promise<{
  started_at: number; session_name: string | null; duration_s: number | null;
  exercise_name: string; position: number; weight_kg: number | null; reps: number | null;
  distance_m: number | null; duration_set_s: number | null; note: string | null;
  session_note: string | null; rpe: number | null;
}[]> {
  return db.getAllAsync(
    `SELECT s.started_at,
            s.name AS session_name,
            CASE WHEN s.ended_at IS NULL THEN NULL ELSE s.ended_at - s.started_at END AS duration_s,
            x.name AS exercise_name,
            e.position,
            e.weight_kg,
            e.reps,
            e.distance_m,
            e.duration_s AS duration_set_s,
            e.note,
            s.note AS session_note,
            e.rpe
     FROM set_entry e
     JOIN session s ON s.id = e.session_id
     JOIN exercise x ON x.id = e.exercise_id
     ORDER BY s.started_at, e.position, e.id;`,
  );
}
