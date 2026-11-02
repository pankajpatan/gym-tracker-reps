/**
 * The active session, held in React only as a mirror of what is already in
 * SQLite (F-4).
 *
 * Every mutation writes first and updates state from the result; there is no
 * optimistic-only path, so a force-quit between two taps loses at most the
 * values sitting in the dock — never a logged set. `load()` is what a cold
 * launch calls, and it is the same code path as a resume.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveLogValues, weightIsOptional, type DockState } from '../domain/dock';
import type { MuscleSlug } from '../domain/muscles';
import {
  nextIncompleteIndex, rebuildSession, sessionTotals, type SessionTotals,
} from '../domain/session';
import type { SetRow, SetType } from '../domain/derive';
import {
  activeSession, deleteSession, exercisesByIds, finishSession, logSet,
  previousSetsForExercise, routineExercises, setsForSession, startSession,
  type QueryableDatabase,
} from '../db/queries';
import type { SetRowModel } from './ExerciseCard';

/**
 * Why `logged` is separate from `next`.
 *
 * Returning null for both "nothing was written" and "the exercise is finished"
 * made those indistinguishable, and the caller started a rest timer for a set
 * that never happened. The two answers are different questions.
 */
export type LogOutcome =
  | { readonly logged: false; readonly reason: 'needs-reps' | 'needs-weight' | 'no-session' }
  | { readonly logged: true; readonly next: number | null };

export interface SessionExercise {
  readonly exerciseId: number;
  readonly name: string;
  readonly muscle: MuscleSlug | null;
  /** Drives whether an empty weight is an answer or an omission. */
  readonly equipment: string | null;
  readonly rows: readonly SetRowModel[];
}

export interface ActiveSessionApi {
  readonly sessionId: number | null;
  readonly startedAt: number | null;
  readonly exercises: readonly SessionExercise[];
  readonly totals: SessionTotals;
  readonly loading: boolean;
  start(): Promise<void>;
  startFromRoutine(routineId: number, name: string): Promise<void>;
  addExercise(
    exerciseId: number, name: string, muscle?: MuscleSlug | null,
    equipment?: string | null, plannedSets?: number,
  ): Promise<void>;
  logRow(exerciseIndex: number, rowIndex: number, dock: DockState): Promise<LogOutcome>;
  addSet(exerciseIndex: number): void;
  /** Returns what actually happened, so the screen can say so. */
  finish(): Promise<'saved' | 'discarded'>;
  /** What was just finished, for Apple Health, the summary and the rating ask. */
  lastFinished: {
    startedAt: number; endedAt: number; volumeKg: number; sets: number;
    hadPersonalRecord: boolean;
  } | null;
  discard(): Promise<void>;
}

const PLANNED_SETS = 3;

function blankRow(index: number, previous: SetRowModel['previous']): SetRowModel {
  return { index, done: false, type: 'normal', weightKg: null, reps: null, previous };
}

export function useActiveSession(db: QueryableDatabase | null, now: number): ActiveSessionApi {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [exercises, setExercises] = useState<SessionExercise[]>([]);
  const [stored, setStored] = useState<SetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFinished, setLastFinished] = useState<ActiveSessionApi['lastFinished']>(null);

  /** A cold launch and a resume are the same path: ask the database. */
  const load = useCallback(async (): Promise<void> => {
    if (!db) return;
    const open = await activeSession(db);
    if (!open) {
      setSessionId(null);
      setStartedAt(null);
      setExercises([]);
      setStored([]);
      setLoading(false);
      return;
    }
    setSessionId(open.id);
    setStartedAt(open.started_at);

    // F-4: rebuild the screen from the rows on disk, not just the session id.
    // Restoring the id alone showed "Add your first exercise" over a database
    // that held the whole workout.
    const sets = await setsForSession(db, open.id);
    setStored(sets);

    const ids = [...new Set(sets.map((set) => set.exercise_id))];
    const meta = await exercisesByIds(db, ids);
    const previous = new Map<number, { weightKg: number | null; reps: number | null }[]>();
    for (const id of ids) previous.set(id, await previousSetsForExercise(db, id));

    setExercises(rebuildSession(sets, meta, previous).map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      muscle: exercise.muscle as MuscleSlug | null,
      equipment: exercise.equipment ?? null,
      rows: exercise.rows,
    })));
    setLoading(false);
  }, [db]);

  useEffect(() => { void load(); }, [load]);

  const start = useCallback(async (): Promise<void> => {
    if (!db) return;
    const id = await startSession(db);
    setSessionId(id);
    setStartedAt((await activeSession(db))?.started_at ?? null);
    setExercises([]);
    setStored([]);
  }, [db]);

  /**
   * Starts a session from a routine, laying out its exercises with their target
   * sets already on screen — the reason to keep a routine at all is not having
   * to rebuild it in the gym.
   *
   * Supersets keep their grouping, and rows carry the PREVIOUS column from the
   * last time each exercise was trained, whichever routine that was under.
   */
  const startFromRoutine = useCallback(async (
    routineId: number,
    name: string,
  ): Promise<void> => {
    if (!db) return;
    const plan = await routineExercises(db, routineId);
    const id = await startSession(db, { routineId, name });

    const built: SessionExercise[] = [];
    for (const item of plan) {
      const previous = await previousSetsForExercise(db, item.exercise_id);
      const count = item.target_sets && item.target_sets > 0 ? item.target_sets : PLANNED_SETS;
      built.push({
        exerciseId: item.exercise_id,
        name: item.name,
        muscle: item.muscle as MuscleSlug | null,
        equipment: item.equipment ?? null,
        rows: Array.from({ length: count }, (_, i) =>
          blankRow(i, previous[i] ?? previous.at(-1) ?? null)),
      });
    }

    setSessionId(id);
    setStartedAt((await activeSession(db))?.started_at ?? null);
    setExercises(built);
    setStored([]);
  }, [db]);

  const addExercise = useCallback(async (
    exerciseId: number,
    name: string,
    muscle: MuscleSlug | null = null,
    equipment: string | null = null,
    plannedSets = PLANNED_SETS,
  ): Promise<void> => {
    if (!db) return;
    const previous = await previousSetsForExercise(db, exerciseId);
    const rows = Array.from({ length: plannedSets }, (_, i) =>
      blankRow(i, previous[i] ?? previous.at(-1) ?? null));
    setExercises((current) => [...current, { exerciseId, name, muscle, equipment, rows }]);
  }, [db]);

  /**
   * Logs one row and returns the index to focus next, or null when the
   * exercise is finished. The write happens before the row turns green: the
   * green fill is a report of what is on disk, not a promise about it.
   */
  const logRow = useCallback(async (
    exerciseIndex: number,
    rowIndex: number,
    dock: DockState,
  ): Promise<LogOutcome> => {
    if (!db || sessionId === null) return { logged: false, reason: 'no-session' };
    const exercise = exercises[exerciseIndex];
    const row = exercise?.rows[rowIndex];
    if (!exercise || !row) return { logged: false, reason: 'no-session' };

    const resolved = resolveLogValues(dock, row.previous, weightIsOptional(exercise.equipment));
    if (resolved.kind !== 'ok') return { logged: false, reason: resolved.kind };
    const values = resolved.values;

    const position = rowIndex + 1;
    await logSet(db, {
      sessionId,
      exerciseId: exercise.exerciseId,
      position,
      weightKg: values.weight,
      reps: values.reps,
      type: row.type as SetType,
    });

    setStored(await setsForSession(db, sessionId));
    setExercises((current) => current.map((ex, i) => {
      if (i !== exerciseIndex) return ex;
      return {
        ...ex,
        rows: ex.rows.map((r) => r.index === rowIndex
          ? { ...r, done: true, weightKg: values.weight, reps: values.reps }
          : r),
      };
    }));

    const after = exercise.rows.map((r) => ({ done: r.index === rowIndex ? true : r.done }));
    return { logged: true, next: nextIncompleteIndex(after, rowIndex) };
  }, [db, sessionId, exercises]);

  const addSet = useCallback((exerciseIndex: number): void => {
    setExercises((current) => current.map((ex, i) => {
      if (i !== exerciseIndex) return ex;
      const last = ex.rows.at(-1);
      return { ...ex, rows: [...ex.rows, blankRow(ex.rows.length, last?.previous ?? null)] };
    }));
  }, []);

  /**
   * Finishing a workout with no sets logged **discards it** rather than saving
   * an empty one.
   *
   * A zero-set session is not a small piece of untidy history, it is a false
   * one: `routineLastTrained` would show "Last: today" on a routine that was
   * never trained, and every feature reading finished sessions — streaks,
   * weekly volume, the PREVIOUS column — would repeat that. Opening the app,
   * tapping start and putting the phone away is a common thing to do, and it
   * must leave no trace.
   *
   * Warm-ups count as sets here: warming up and stopping is still training
   * that happened, and the lifter chose to record it.
   */
  const finish = useCallback(async (): Promise<'saved' | 'discarded'> => {
    if (!db || sessionId === null) return 'discarded';

    const logged = await setsForSession(db, sessionId);
    if (logged.length === 0) {
      await deleteSession(db, sessionId);
      await load();
      return 'discarded';
    }

    const endedAt = Math.floor(Date.now() / 1000);
    const totals = sessionTotals(logged, startedAt ?? endedAt, endedAt);

    /**
     * Records are recomputed by `finishSession`, so "did this session set one"
     * is the difference across that call — a record whose `achieved_at` falls
     * inside the session that just ended.
     */
    await finishSession(db, sessionId, { endedAt });
    const records = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pr
       WHERE achieved_at >= ? AND achieved_at <= ?;`,
      startedAt ?? endedAt, endedAt,
    );

    setLastFinished({
      startedAt: startedAt ?? endedAt,
      endedAt,
      volumeKg: totals.volumeKg,
      sets: totals.sets,
      hadPersonalRecord: (records[0]?.n ?? 0) > 0,
    });
    await load();
    return 'saved';
  }, [db, sessionId, startedAt, load]);

  /** Explicit discard: throw the session away whatever is in it. */
  const discard = useCallback(async (): Promise<void> => {
    if (!db || sessionId === null) return;
    await deleteSession(db, sessionId);
    await load();
  }, [db, sessionId, load]);

  const totals = useMemo(
    () => sessionTotals(stored, startedAt ?? now, now),
    [stored, startedAt, now],
  );

  return {
    sessionId, startedAt, exercises, totals, loading,
    start, startFromRoutine, addExercise, logRow, addSet, finish, discard, lastFinished,
  };
}
