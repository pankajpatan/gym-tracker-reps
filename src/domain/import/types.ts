/**
 * The shape every parser produces (IMPORT.md).
 *
 * One neutral structure so the preview, the matcher, the routine inference and
 * the writer are all written once rather than three times. Weights are already
 * in **kg** here — unit conversion is a parser's job, because only the parser
 * knows what the file meant.
 */

export type ImportSource = 'strong' | 'hevy' | 'alpha' | 'unknown';

export type ParsedSetType = 'normal' | 'warmup' | 'drop' | 'failure';

export interface ParsedSet {
  readonly exerciseName: string;
  readonly weightKg: number | null;
  readonly reps: number | null;
  readonly durationS: number | null;
  readonly distanceM: number | null;
  readonly type: ParsedSetType;
  readonly rpe: number | null;
  readonly supersetGroup: number | null;
}

export interface ParsedSession {
  /** Epoch seconds, UTC. */
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly title: string | null;
  readonly note: string | null;
  readonly sets: ParsedSet[];
}

export interface SkippedRow {
  readonly line: number;
  readonly reason: string;
  readonly text: string;
}

export interface ParsedRoutine {
  readonly name: string;
  readonly exerciseNames: string[];
  readonly targetSets: number[];
  /** 'export' when the file contained the routine; 'inferred' when we derived it. */
  readonly origin: 'export' | 'inferred';
}

export interface ParsedFile {
  readonly source: ImportSource;
  readonly sessions: ParsedSession[];
  /** Routines the file stated outright — only Alpha has these. */
  readonly routines: ParsedRoutine[];
  readonly skipped: SkippedRow[];
}

export const EMPTY: ParsedFile = { source: 'unknown', sessions: [], routines: [], skipped: [] };

/** Set-type words every export uses, mapped to ours (IMPORT.md). */
export function normaliseSetType(raw: string | undefined | null): ParsedSetType {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'warmup' || value === 'warm up' || value === 'warm-up' || value === 'w') return 'warmup';
  if (value === 'drop' || value === 'dropset' || value === 'd') return 'drop';
  if (value === 'failure' || value === 'f') return 'failure';
  return 'normal';
}

/**
 * A number as any export might write it: `62.5`, `62,5`, `1,234.5`, blank.
 *
 * The decimal comma is most of what Hevy's "file must be English" limitation
 * actually means, and is a limit we exist to beat (IMPORT.md).
 */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const text = raw.trim();
  if (text === '' || text === '-' || text === '—') return null;

  // 1,234.5 -> thousands separator; 62,5 -> decimal comma.
  const cleaned = /,\d{3}(\D|$)/.test(text)
    ? text.replace(/,/g, '')
    : text.replace(',', '.');

  const digits = cleaned.replace(/[^\d.\-+]/g, '');
  // Stripping the non-numeric characters out of "abc" leaves "", and Number("")
  // is 0 — which would have written junk into the database as a zero-weight
  // set rather than reporting the row as unreadable.
  if (!/\d/.test(digits)) return null;

  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

const LB_TO_KG = 0.45359237;

export function toKilograms(value: number | null, unit: 'kg' | 'lb'): number | null {
  if (value === null) return null;
  return unit === 'kg' ? value : Math.round(value * LB_TO_KG * 1000) / 1000;
}
