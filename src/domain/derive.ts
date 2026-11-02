/**
 * Derived values: e1RM, volume, and the personal records built from them.
 *
 * Pure functions over plain rows — no database, no Expo. PRs are computed here
 * and *written* on session end (SPEC.md: "never computed on read"), so this
 * module is the single definition of what a record means.
 */

export type SetType = 'normal' | 'warmup' | 'drop' | 'failure';

export interface SetRow {
  readonly id?: number;
  readonly exercise_id: number;
  readonly weight_kg: number | null;
  readonly reps: number | null;
  readonly type: SetType;
  readonly done_at: number | null;
}

export type E1rmFormula = 'epley' | 'brzycki';

/**
 * Epley by default, Brzycki behind the `e1rm_formula` setting.
 *
 * A single rep is its own one-rep max under both formulas; Epley's `w*(1+r/30)`
 * already yields exactly `w` at r=1, but Brzycki's `w*36/(37-r)` does not
 * (it gives w*1.0), so the special case is stated once, here.
 *
 * Brzycki diverges sharply above ~10 reps and is undefined at 37; callers get
 * `null` rather than a number that would silently become a fake record.
 */
export function e1rm(
  weightKg: number,
  reps: number,
  formula: E1rmFormula = 'epley',
): number | null {
  if (weightKg <= 0 || reps <= 0) return null;
  if (reps === 1) return weightKg;

  if (formula === 'brzycki') {
    if (reps >= 37) return null;
    return weightKg * (36 / (37 - reps));
  }
  return weightKg * (1 + reps / 30);
}

/**
 * Working volume: warm-ups excluded (SPEC.md).
 *
 * Bodyweight sets contribute nothing — `weight_kg` is null for 281 of 1,922
 * rows in the real Hevy export, and counting them as zero is correct: we do not
 * know the lifter's bodyweight and inventing it would corrupt every chart.
 */
export function volume(sets: readonly SetRow[]): number {
  let total = 0;
  for (const set of sets) {
    if (set.type === 'warmup') continue;
    if (set.weight_kg === null || set.reps === null) continue;
    total += set.weight_kg * set.reps;
  }
  return total;
}

export type PrKind = 'weight' | 'reps' | 'volume' | 'e1rm';

export interface PrRow {
  readonly exercise_id: number;
  readonly kind: PrKind;
  readonly value: number;
  readonly set_id: number | null;
  readonly achieved_at: number;
}

/**
 * The best set per record kind for one exercise.
 *
 * Warm-ups are never records. Ties keep the *earlier* set: a record belongs to
 * the session that first achieved it, and re-importing the same history must
 * not shuffle record dates.
 */
export function personalRecords(
  exerciseId: number,
  sets: readonly SetRow[],
  formula: E1rmFormula = 'epley',
): PrRow[] {
  const best = new Map<PrKind, PrRow>();

  const consider = (kind: PrKind, value: number | null, set: SetRow): void => {
    if (value === null || value <= 0) return;
    const at = set.done_at ?? 0;
    const held = best.get(kind);
    if (held && (held.value > value || (held.value === value && held.achieved_at <= at))) {
      return;
    }
    best.set(kind, {
      exercise_id: exerciseId,
      kind,
      value,
      set_id: set.id ?? null,
      achieved_at: at,
    });
  };

  for (const set of sets) {
    if (set.type === 'warmup') continue;
    consider('weight', set.weight_kg, set);
    consider('reps', set.reps, set);
    if (set.weight_kg !== null && set.reps !== null) {
      consider('volume', set.weight_kg * set.reps, set);
      consider('e1rm', e1rm(set.weight_kg, set.reps, formula), set);
    }
  }

  return [...best.values()];
}
