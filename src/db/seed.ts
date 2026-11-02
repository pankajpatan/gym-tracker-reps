/**
 * Loading the shipped exercise library (SPEC.md F-9).
 *
 * Seeds are immutable: a user who edits one gets a custom copy, and the seed
 * row is left alone so a library update never clobbers their data. That is why
 * this can run on every launch — it inserts what is missing and touches
 * nothing else.
 */

import { normaliseName } from '../domain/normalise';
import type { MuscleSlug } from '../domain/muscles';
import type { QueryableDatabase } from './queries';

export interface SeedExercise {
  readonly name: string;
  readonly equipment: string | null;
  readonly mechanic: string | null;
  readonly level: string | null;
  readonly primary: readonly MuscleSlug[];
  readonly secondary: readonly MuscleSlug[];
  readonly instructions: string | null;
}

export interface SeedReport {
  readonly inserted: number;
  readonly skipped: number;
}

/**
 * `muscle` holds the primary slug — it is what the row chip and the picker
 * filter read. The full primary/secondary lists live in `art_ref` as JSON so
 * the About tab can light both bodies without a second table; v1 has no query
 * that needs to filter on a secondary muscle, and inventing a join table for
 * one screen would be the wrong shape.
 */
export async function seedExercises(
  db: QueryableDatabase,
  exercises: readonly SeedExercise[],
): Promise<SeedReport> {
  const existing = await db.getAllAsync<{ name_norm: string }>(
    'SELECT name_norm FROM exercise;',
  );
  const known = new Set(existing.map((row) => row.name_norm));

  let inserted = 0;
  let skipped = 0;

  await db.execAsync('BEGIN;');
  try {
    for (const exercise of exercises) {
      const norm = normaliseName(exercise.name);
      if (known.has(norm)) { skipped += 1; continue; }
      known.add(norm);

      await db.runAsync(
        `INSERT INTO exercise (name, name_norm, muscle, equipment, instructions, art_ref, is_custom)
         VALUES (?, ?, ?, ?, ?, ?, 0);`,
        exercise.name,
        norm,
        exercise.primary[0] ?? null,
        exercise.equipment,
        exercise.instructions,
        JSON.stringify({ primary: exercise.primary, secondary: exercise.secondary }),
      );
      inserted += 1;
    }
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }

  return { inserted, skipped };
}

export interface ExerciseArt {
  readonly primary: readonly MuscleSlug[];
  readonly secondary: readonly MuscleSlug[];
}

/** Reads `art_ref` back, tolerating a row that predates it or was hand-made. */
export function parseArt(artRef: string | null): ExerciseArt {
  if (!artRef) return { primary: [], secondary: [] };
  try {
    const parsed = JSON.parse(artRef) as Partial<ExerciseArt>;
    return { primary: parsed.primary ?? [], secondary: parsed.secondary ?? [] };
  } catch {
    return { primary: [], secondary: [] };
  }
}
