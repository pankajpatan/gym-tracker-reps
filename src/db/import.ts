/**
 * Writing an import (IMPORT.md).
 *
 * Three properties this has to hold, in order of how badly they hurt:
 *
 * 1. **Idempotent.** Re-importing the same file changes nothing. Hevy allows
 *    one import ever, which is the trap we exist to avoid — so ours must be
 *    safe to run repeatedly rather than rationed.
 * 2. **Atomic.** A partial import is worse than none: half a history looks
 *    like lost data and cannot be told apart from a bad export.
 * 3. **Reversible.** The whole batch comes out by id, and PRs are recomputed
 *    for the exercises it touched.
 */

import { normaliseName } from '../domain/normalise';
import { matchExercise, type LibraryEntry } from '../domain/match';
import type { ParsedFile, ParsedRoutine, ParsedSession } from '../domain/import/types';
import {
  addExerciseToRoutine, createRoutine, insertExercise, recomputePrs,
  type QueryableDatabase,
} from './queries';

export interface ExerciseDecision {
  /** The name as the export wrote it. */
  readonly exportedName: string;
  /** An existing exercise to use, or null to create a custom one. */
  readonly exerciseId: number | null;
}

export interface ImportPlan {
  readonly file: ParsedFile;
  /** Every distinct exercise name in the file, with our best guess. */
  readonly decisions: ExerciseDecision[];
  readonly routines: ParsedRoutine[];
  readonly sessionCount: number;
  readonly setCount: number;
  readonly unmatched: string[];
  /** Matches we are not confident about — shown, not silently applied. */
  readonly uncertain: { exportedName: string; suggestion: string }[];
}

/** Distinct exercise names in the file, in first-seen order. */
export function exerciseVocabulary(file: ParsedFile): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const session of file.sessions) {
    for (const set of session.sets) {
      const key = normaliseName(set.exerciseName);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(set.exerciseName);
    }
  }
  for (const routine of file.routines) {
    for (const name of routine.exerciseNames) {
      const key = normaliseName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/**
 * Everything the preview needs, computed before a single row is written
 * (IMPORT.md step 4: "Nothing is written yet").
 */
export async function planImport(
  db: QueryableDatabase,
  file: ParsedFile,
  routines: ParsedRoutine[],
): Promise<ImportPlan> {
  const library = await db.getAllAsync<LibraryEntry>(
    'SELECT id, name, equipment FROM exercise WHERE archived = 0;',
  );

  const decisions: ExerciseDecision[] = [];
  const unmatched: string[] = [];
  const uncertain: { exportedName: string; suggestion: string }[] = [];

  for (const exportedName of exerciseVocabulary(file)) {
    const match = matchExercise(exportedName, library);
    decisions.push({ exportedName, exerciseId: match?.entry.id ?? null });
    if (!match) unmatched.push(exportedName);
    else if (!match.confident) uncertain.push({ exportedName, suggestion: match.entry.name });
  }

  return {
    file,
    decisions,
    routines,
    sessionCount: file.sessions.length,
    setCount: file.sessions.reduce((total, session) => total + session.sets.length, 0),
    unmatched,
    uncertain,
  };
}

export interface ImportResult {
  readonly batchId: number;
  readonly sessions: number;
  readonly sets: number;
  readonly routines: number;
  readonly duplicate: boolean;
  /** Sessions skipped because that exact workout is already in the database. */
  readonly overlapping: number;
}

/** SHA-256 of the raw bytes, as `import_batch.file_hash` (IMPORT.md). */
export async function alreadyImported(
  db: QueryableDatabase,
  fileHash: string,
): Promise<{ id: number; imported_at: number } | null> {
  return db.getFirstAsync<{ id: number; imported_at: number }>(
    'SELECT id, imported_at FROM import_batch WHERE file_hash = ?;',
    fileHash,
  );
}

/**
 * A session already present, matched on start time and its exercise set.
 *
 * Two exports of overlapping periods is the normal case — someone exports,
 * trains for a week, exports again — and the second import must add the new
 * week without duplicating the old one.
 */
async function sessionExists(
  db: QueryableDatabase,
  session: ParsedSession,
  exerciseIds: readonly number[],
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM session WHERE started_at = ? LIMIT 1;',
    session.startedAt,
  );
  if (!row) return false;
  if (exerciseIds.length === 0) return true;

  const existing = await db.getAllAsync<{ exercise_id: number }>(
    'SELECT DISTINCT exercise_id FROM set_entry WHERE session_id = ?;',
    row.id,
  );
  const present = new Set(existing.map((e) => e.exercise_id));
  return exerciseIds.some((id) => present.has(id));
}

export async function writeImport(
  db: QueryableDatabase,
  plan: ImportPlan,
  fileHash: string,
  options: { selectedRoutines?: readonly number[] } = {},
): Promise<ImportResult> {
  const existing = await alreadyImported(db, fileHash);
  if (existing) {
    return { batchId: existing.id, sessions: 0, sets: 0, routines: 0, duplicate: true, overlapping: 0 };
  }

  /**
   * Exercises are resolved — and created where needed — BEFORE the transaction
   * opens. Creating one inside it would mean a single unimportable name rolls
   * back a thousand good sessions.
   */
  const idByName = new Map<string, number>();
  for (const decision of plan.decisions) {
    const key = normaliseName(decision.exportedName);
    if (decision.exerciseId !== null) {
      idByName.set(key, decision.exerciseId);
      continue;
    }
    const existingRow = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM exercise WHERE name_norm = ?;', key,
    );
    idByName.set(key, existingRow?.id ?? await insertExercise(db, {
      name: decision.exportedName,
      isCustom: true,
    }));
  }

  const resolve = (name: string): number | undefined => idByName.get(normaliseName(name));

  // Which sessions are genuinely new, decided before writing anything.
  const toWrite: ParsedSession[] = [];
  let overlapping = 0;
  for (const session of plan.file.sessions) {
    const ids = [...new Set(session.sets.map((set) => resolve(set.exerciseName)).filter((id): id is number => id !== undefined))];
    if (await sessionExists(db, session, ids)) { overlapping += 1; continue; }
    toWrite.push(session);
  }

  const wanted = options.selectedRoutines
    ? plan.routines.filter((_, index) => options.selectedRoutines?.includes(index))
    : plan.routines;

  let batchId = 0;
  let sets = 0;

  await db.execAsync('BEGIN;');
  try {
    const batch = await db.runAsync(
      `INSERT INTO import_batch (source, file_hash, imported_at, sessions, sets, routines)
       VALUES (?, ?, ?, ?, ?, ?);`,
      plan.file.source, fileHash, Math.floor(Date.now() / 1000),
      toWrite.length, 0, wanted.length,
    );
    batchId = (batch as { lastInsertRowId: number }).lastInsertRowId;

    for (const session of toWrite) {
      const inserted = await db.runAsync(
        `INSERT INTO session (routine_id, name, started_at, ended_at, note, import_batch_id)
         VALUES (NULL, ?, ?, ?, ?, ?);`,
        session.title, session.startedAt, session.endedAt, session.note, batchId,
      );
      const sessionId = (inserted as { lastInsertRowId: number }).lastInsertRowId;

      let position = 0;
      for (const set of session.sets) {
        const exerciseId = resolve(set.exerciseName);
        if (exerciseId === undefined) continue;
        position += 1;
        await db.runAsync(
          `INSERT INTO set_entry
             (session_id, exercise_id, position, superset_group, weight_kg, reps,
              duration_s, distance_m, type, rpe, note, done_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?);`,
          sessionId, exerciseId, position, set.supersetGroup,
          set.weightKg, set.reps, set.durationS, set.distanceM,
          set.type, set.rpe, session.startedAt,
        );
        sets += 1;
      }
    }

    for (const routine of wanted) {
      const routineId = await createRoutine(db, routine.name, 'import', batchId);
      for (const [index, name] of routine.exerciseNames.entries()) {
        const exerciseId = resolve(name);
        if (exerciseId === undefined) continue;
        await addExerciseToRoutine(db, routineId, exerciseId, {
          targetSets: routine.targetSets[index] ?? 3,
        });
      }
    }

    await db.runAsync('UPDATE import_batch SET sets = ? WHERE id = ?;', sets, batchId);
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }

  // PRs are recomputed after the commit: they are derived, and holding the
  // transaction open across them would lengthen it for no safety.
  for (const exerciseId of new Set(idByName.values())) {
    await recomputePrs(db, exerciseId);
  }

  return { batchId, sessions: toWrite.length, sets, routines: wanted.length, duplicate: false, overlapping };
}

/**
 * Undo (IMPORT.md): the whole batch comes out, and the records it may have set
 * are recomputed from what remains.
 */
export async function undoImport(db: QueryableDatabase, batchId: number): Promise<void> {
  const touched = await db.getAllAsync<{ exercise_id: number }>(
    `SELECT DISTINCT e.exercise_id FROM set_entry e
     JOIN session s ON s.id = e.session_id
     WHERE s.import_batch_id = ?;`,
    batchId,
  );

  await db.execAsync('BEGIN;');
  try {
    await db.runAsync('DELETE FROM session WHERE import_batch_id = ?;', batchId);
    // Only this batch's routines. `source = 'import'` alone would take every
    // previous import's routines with it, and scoping by timestamp broke as
    // soon as two imports landed in the same second — hence the column.
    await db.runAsync('DELETE FROM routine WHERE import_batch_id = ?;', batchId);
    await db.runAsync('DELETE FROM import_batch WHERE id = ?;', batchId);
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }

  for (const row of touched) await recomputePrs(db, row.exercise_id);
}

export interface ImportBatchSummary {
  readonly id: number;
  readonly source: string;
  readonly imported_at: number;
  readonly sessions: number;
  readonly sets: number;
  readonly routines: number;
}

/**
 * The most recent import, for Settings' undo row (IMPORT.md: "Offer it on the
 * success screen and in Settings for 30 days").
 *
 * Thirty days because an import is reversible, not provisional: past that the
 * history is simply the lifter's history, and an undo button hanging over it
 * invites an accident rather than offering a remedy.
 */
export const UNDO_WINDOW_SECONDS = 30 * 24 * 60 * 60;

export async function undoableImport(
  db: QueryableDatabase,
  now = Math.floor(Date.now() / 1000),
): Promise<ImportBatchSummary | null> {
  return db.getFirstAsync<ImportBatchSummary>(
    `SELECT id, source, imported_at, sessions, sets, routines
     FROM import_batch
     WHERE imported_at >= ?
     ORDER BY imported_at DESC, id DESC
     LIMIT 1;`,
    now - UNDO_WINDOW_SECONDS,
  );
}
