/**
 * Matching an exported exercise name to one in the library (MATCHING.md).
 *
 * The rule IMPORT.md originally specified — token-set similarity ≥ 0.9 — was
 * measured against the real fixtures and scored 27% / 34% / 19% on
 * Strong / Hevy / Alpha. The cause is that the library's names are *qualified*
 * (`Barbell Bench Press - Medium Grip`) while exports use canonical short names
 * (`Bench Press (Barbell)`). A threshold on equality can never bridge that; a
 * score on containment can, and the same fixtures then give 86% / 84% / 54%.
 *
 * So: how much of the *exported* name does a library entry account for, with a
 * smaller credit for not dragging in extra words.
 */

import { normaliseName } from './normalise';

/** Words that carry no identifying information in an exercise name. */
const STOPWORDS = new Set(['the', 'a', 'an', 'with', 'on', 'and', 'to', 'of']);

/**
 * Plural and spelling variants collapsed to one form. Deliberately small:
 * every entry here is a spelling difference, never a claim that two movements
 * are the same. Synonyms between *movements* belong in the alias table, where
 * a human signs off on them.
 */
const VARIANTS: Readonly<Record<string, string>> = {
  pullups: 'pull up', pullup: 'pull up', chinups: 'chin up', chinup: 'chin up',
  pushups: 'push up', pushup: 'push up', situps: 'sit up', situp: 'sit up',
  curls: 'curl', raises: 'raise', presses: 'press', rows: 'row', flyes: 'fly',
  flys: 'fly', extensions: 'extension', pulldowns: 'pulldown', ups: 'up',
  dumbbells: 'dumbbell', barbells: 'barbell', kettlebells: 'kettlebell',
  squats: 'squat', deadlifts: 'deadlift', lunges: 'lunge', dips: 'dip',
};

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normaliseName(text).split(' ')) {
    if (!raw) continue;
    const mapped = VARIANTS[raw] ?? raw;
    for (const word of mapped.split(' ')) {
      if (!STOPWORDS.has(word)) out.add(word);
    }
  }
  return out;
}

/**
 * Alpha names the movement and appends the grip: `Rows with Wide Neutral Grip`,
 * `Pull-Ups with Close Neutral Grip`. There are ~20 such variants in one real
 * export and they are a *rule*, not twenty aliases — strip the qualifier and
 * match the stem. The grip is lost, which is correct: the library has no
 * per-grip entries to match it to.
 */
export function stripGripQualifier(name: string): string {
  return name.replace(/\s+with\s+[^,()]*\bgrip\b\s*$/i, '').trim();
}

/**
 * Exports write equipment in brackets (`Bench Press (Barbell)`) or after a
 * separator (`Bench Press · Barbell`, Alpha's form). Both are just more tokens
 * for matching, so they are folded in rather than parsed out.
 */
export function queryTokens(exported: string): Set<string> {
  return tokens(stripGripQualifier(exported).replace(/[()·]/g, ' '));
}

export interface LibraryEntry {
  readonly id: number;
  readonly name: string;
  readonly equipment?: string | null;
}

export interface MatchResult {
  readonly entry: LibraryEntry;
  readonly score: number;
  /** Below `CONFIDENT`, the preview asks the user rather than assuming. */
  readonly confident: boolean;
}

/** Accept nothing below this; `Chest Fly (Dumbbell)` → `Dumbbell Clean` scores 0.38. */
export const ACCEPT = 0.62;
/** At or above this we match silently; between the two, we show our working. */
export const CONFIDENT = 0.75;

function score(query: Set<string>, entry: Set<string>): number {
  if (query.size === 0 || entry.size === 0) return 0;
  let shared = 0;
  for (const token of query) if (entry.has(token)) shared += 1;
  if (shared === 0) return 0;

  const coverage = shared / query.size;   // how much of the export we explained
  const precision = shared / entry.size;  // how little we dragged in
  return coverage * 0.75 + precision * 0.25;
}

/**
 * Best library entry for an exported name, or null if nothing clears `ACCEPT`.
 *
 * Ties break toward the *shorter* library name: between `Bench Press` and
 * `Barbell Bench Press - Medium Grip`, the plain one is the safer guess when
 * the export said no more than "bench press".
 */
export function matchExercise(
  exported: string,
  library: readonly LibraryEntry[],
): MatchResult | null {
  const query = queryTokens(exported);
  let best: MatchResult | null = null;

  for (const entry of library) {
    const value = score(query, tokens(`${entry.name} ${entry.equipment ?? ''}`));
    if (value < ACCEPT) continue;
    if (
      !best ||
      value > best.score ||
      (value === best.score && entry.name.length < best.entry.name.length)
    ) {
      best = { entry, score: value, confident: value >= CONFIDENT };
    }
  }
  return best;
}
