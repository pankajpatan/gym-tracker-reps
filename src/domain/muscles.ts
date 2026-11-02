/**
 * The muscle vocabulary, and the bridge between the two that exist.
 *
 * `free-exercise-db` names muscles one way (`shoulders`, `abdominals`); the
 * body artwork names them another (`deltoids`, `abs`). Neither is wrong and
 * neither is changing, so the mapping is stated once, here, and both the seed
 * generator and the UI read it.
 */

/** Slugs the body artwork can light. */
export type MuscleSlug =
  | 'abs' | 'adductors' | 'biceps' | 'calves' | 'chest' | 'deltoids'
  | 'forearm' | 'gluteal' | 'hamstring' | 'lower-back' | 'neck'
  | 'obliques' | 'quadriceps' | 'trapezius' | 'triceps' | 'upper-back';

/**
 * Dataset muscle → artwork slug.
 *
 * Two lossy entries, both deliberate:
 * - `lats` and `middle back` both become `upper-back`. The artwork has one
 *   back region, so the chip says "back". Splitting it means hand-editing the
 *   path, which is a v1.1 job at best.
 * - `abductors` has no region at all. It maps to `gluteal`, which is where the
 *   work is felt and is the least wrong of the available answers.
 */
export const MUSCLE_SLUG: Readonly<Record<string, MuscleSlug>> = {
  abdominals: 'abs',
  abductors: 'gluteal',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearm',
  glutes: 'gluteal',
  hamstrings: 'hamstring',
  lats: 'upper-back',
  'lower back': 'lower-back',
  'middle back': 'upper-back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  shoulders: 'deltoids',
  traps: 'trapezius',
  triceps: 'triceps',
};

/** What the lifter reads on a chip — the dataset's word, tidied. */
export const MUSCLE_LABEL: Readonly<Record<MuscleSlug, string>> = {
  abs: 'Abs',
  adductors: 'Adductors',
  biceps: 'Biceps',
  calves: 'Calves',
  chest: 'Chest',
  deltoids: 'Shoulders',
  forearm: 'Forearms',
  gluteal: 'Glutes',
  hamstring: 'Hamstrings',
  'lower-back': 'Lower back',
  neck: 'Neck',
  obliques: 'Obliques',
  quadriceps: 'Quads',
  trapezius: 'Traps',
  triceps: 'Triceps',
  'upper-back': 'Back',
};

export function toSlug(datasetMuscle: string): MuscleSlug | null {
  return MUSCLE_SLUG[datasetMuscle.toLowerCase().trim()] ?? null;
}

/** Which body the chip should crop from. */
export const MUSCLE_SIDE: Readonly<Record<MuscleSlug, 'front' | 'back'>> = {
  abs: 'front', adductors: 'front', biceps: 'front', calves: 'back',
  chest: 'front', deltoids: 'front', forearm: 'front', gluteal: 'back',
  hamstring: 'back', 'lower-back': 'back', neck: 'front', obliques: 'front',
  quadriceps: 'front', trapezius: 'back', triceps: 'back', 'upper-back': 'back',
};
