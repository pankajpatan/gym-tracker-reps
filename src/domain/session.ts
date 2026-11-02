/**
 * Session-shaped reads over set rows: the header totals and the focus rule.
 *
 * Pure so the logging screen's arithmetic is testable without a device. The
 * screen renders these; it never computes them inline.
 */

import { volume, type SetRow } from './derive';

export interface SessionTotals {
  readonly volumeKg: number;
  readonly sets: number;
  readonly durationS: number;
}

/**
 * Header totals (UI.md §3).
 *
 * `sets` counts only completed working sets — an empty planned row is not a set
 * the lifter has done, and warm-ups are excluded from volume but *are* counted
 * as sets, because the header's "Sets 3" answers "how much have I done".
 */
export function sessionTotals(
  sets: readonly SetRow[],
  startedAt: number,
  now: number,
): SessionTotals {
  return {
    volumeKg: volume(sets),
    sets: sets.length,
    durationS: Math.max(0, now - startedAt),
  };
}

/** `1:15`, or `1:02:30` once a session passes an hour. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export interface PlannedSet {
  readonly done: boolean;
}

/**
 * Where focus goes after a set is logged (UI.md §3.2): the next incomplete row,
 * searched from the one just logged, then wrapping to earlier rows the lifter
 * may have skipped. Returns null when the exercise is finished, which is the
 * signal to advance to the next card.
 */
export function nextIncompleteIndex(
  rows: readonly PlannedSet[],
  from: number,
): number | null {
  for (let i = from + 1; i < rows.length; i += 1) {
    if (!rows[i]?.done) return i;
  }
  for (let i = 0; i <= from && i < rows.length; i += 1) {
    if (!rows[i]?.done) return i;
  }
  return null;
}

/**
 * Rebuilding the on-screen session from what is in the database (F-4).
 *
 * The session row and its sets survive a force-quit, but that is only half of
 * "resumes exactly": the screen has to be reconstructed from those rows too.
 * Restoring the session id without rebuilding the exercise cards showed an
 * empty "Add your first exercise" over a database that held the whole workout.
 *
 * Pure, so the resume path is testable without a device — which is exactly the
 * gap that let the bug through.
 */

export interface StoredSet {
  readonly id?: number;
  readonly exercise_id: number;
  readonly weight_kg: number | null;
  readonly reps: number | null;
  readonly type: string;
}

export interface ExerciseMeta {
  readonly id: number;
  readonly name: string;
  readonly muscle: string | null;
  readonly equipment?: string | null;
}

export interface RebuiltRow {
  readonly index: number;
  readonly done: boolean;
  readonly type: 'normal' | 'warmup' | 'drop' | 'failure';
  readonly weightKg: number | null;
  readonly reps: number | null;
  readonly previous: { weightKg: number | null; reps: number | null } | null;
}

export interface RebuiltExercise {
  readonly exerciseId: number;
  readonly name: string;
  readonly muscle: string | null;
  readonly equipment: string | null;
  readonly rows: RebuiltRow[];
}

/**
 * Exercises appear in the order they were first logged, each carrying its
 * completed sets plus one empty row to continue on — reopening mid-exercise
 * should leave the next set ready, not require "+ Add set" first.
 */
export function rebuildSession(
  sets: readonly StoredSet[],
  meta: ReadonlyMap<number, ExerciseMeta>,
  previous: ReadonlyMap<number, { weightKg: number | null; reps: number | null }[]> = new Map(),
): RebuiltExercise[] {
  const order: number[] = [];
  const grouped = new Map<number, StoredSet[]>();

  for (const set of sets) {
    if (!grouped.has(set.exercise_id)) {
      grouped.set(set.exercise_id, []);
      order.push(set.exercise_id);
    }
    grouped.get(set.exercise_id)?.push(set);
  }

  return order.map((exerciseId) => {
    const logged = grouped.get(exerciseId) ?? [];
    const history = previous.get(exerciseId) ?? [];
    const info = meta.get(exerciseId);

    const rows: RebuiltRow[] = logged.map((set, index) => ({
      index,
      done: true,
      type: (['normal', 'warmup', 'drop', 'failure'].includes(set.type)
        ? set.type
        : 'normal') as RebuiltRow['type'],
      weightKg: set.weight_kg,
      reps: set.reps,
      previous: history[index] ?? null,
    }));

    rows.push({
      index: rows.length,
      done: false,
      type: 'normal',
      weightKg: null,
      reps: null,
      previous: history[rows.length] ?? history.at(-1) ?? null,
    });

    return {
      exerciseId,
      name: info?.name ?? `Exercise ${exerciseId}`,
      muscle: info?.muscle ?? null,
      equipment: info?.equipment ?? null,
      rows,
    };
  });
}

/**
 * What the input dock should show for the row now in focus.
 *
 * Priority: the row's own values, then the set just logged on this exercise,
 * then the PREVIOUS column. The middle step is the one that makes logging two
 * taps — a lifter doing 3x60kg should not re-enter 60 for every set, and
 * falling straight through to PREVIOUS left the dock empty on a first-time
 * exercise.
 */
export function dockSeed(
  row: { weightKg: number | null; reps: number | null; previous: { weightKg: number | null; reps: number | null } | null } | undefined,
  lastLogged: { weightKg: number | null; reps: number | null } | null,
): { weight: number | null; reps: number | null } {
  if (!row) return { weight: null, reps: null };
  return {
    weight: row.weightKg ?? lastLogged?.weightKg ?? row.previous?.weightKg ?? null,
    reps: row.reps ?? lastLogged?.reps ?? row.previous?.reps ?? null,
  };
}
