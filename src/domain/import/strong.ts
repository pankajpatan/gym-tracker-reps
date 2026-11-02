/**
 * Strong CSV (docs/fixtures/strong-*.csv).
 *
 * Two variants in the wild, both confirmed against real exports:
 *   12-col  Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,
 *           Distance,Seconds,Notes,Workout Notes,RPE
 *   10-col  the same without Notes and Workout Notes (legacy, still around)
 *
 * Rows are one set each, grouped into sessions by (Date, Workout Name).
 */

import { indexOfHeaders, normaliseHeader, parseRows } from './csv';
import { detectDayFirst, parseDuration, parseTimestamp } from './dates';
import {
  normaliseSetType, parseNumber, toKilograms,
  type ParsedFile, type ParsedSession, type ParsedSet, type SkippedRow,
} from './types';

export function isStrong(header: readonly string[]): boolean {
  const cells = new Set(normaliseHeader(header));
  return cells.has('workout name') && cells.has('exercise name') && cells.has('set order');
}

/**
 * Strong writes `Weight` with no unit in the header; the app exports in the
 * user's chosen unit. There is no marker in the file, so the caller says which
 * — the import preview asks, rather than the parser silently assuming kg and
 * inflating a US lifter's history by 2.2x.
 */
export function parseStrong(text: string, unit: 'kg' | 'lb' = 'kg'): ParsedFile {
  const rows = parseRows(text);
  const header = normaliseHeader(rows[0] ?? []);
  const at = indexOfHeaders(header);
  const skipped: SkippedRow[] = [];

  const col = (row: string[], name: string): string | undefined => {
    const index = at.get(name);
    return index === undefined ? undefined : row[index];
  };

  const dayFirst = detectDayFirst(rows.slice(1, 40).map((r) => col(r, 'date') ?? ''));
  const sessions = new Map<string, ParsedSession>();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (row.length === 1 && (row[0] ?? '').trim() === '') continue;

    const rawDate = col(row, 'date') ?? '';
    const startedAt = parseTimestamp(rawDate, dayFirst);
    const name = (col(row, 'exercise name') ?? '').trim();

    if (startedAt === null || name === '') {
      skipped.push({ line: i + 1, reason: startedAt === null ? 'unreadable date' : 'no exercise name', text: row.join(',').slice(0, 120) });
      continue;
    }

    const title = (col(row, 'workout name') ?? '').trim() || null;
    const key = `${rawDate}|${title ?? ''}`;
    let session = sessions.get(key);
    if (!session) {
      const duration = parseDuration(col(row, 'duration'));
      session = {
        startedAt,
        endedAt: duration === null ? null : startedAt + duration,
        title,
        note: (col(row, 'workout notes') ?? '').trim() || null,
        sets: [],
      };
      sessions.set(key, session);
    }

    const distance = parseNumber(col(row, 'distance'));
    const seconds = parseNumber(col(row, 'seconds'));
    const set: ParsedSet = {
      exerciseName: name,
      weightKg: toKilograms(parseNumber(col(row, 'weight')), unit),
      reps: parseNumber(col(row, 'reps')) === null ? null : Math.round(parseNumber(col(row, 'reps')) as number),
      // Strong writes 0 rather than blank for unused metrics; 0 distance is
      // not a measurement, it is an empty column.
      durationS: seconds && seconds > 0 ? Math.round(seconds) : null,
      distanceM: distance && distance > 0 ? distance : null,
      type: normaliseSetType(col(row, 'set order')?.match(/[a-z]/i) ? col(row, 'set order') : 'normal'),
      rpe: parseNumber(col(row, 'rpe')),
      supersetGroup: null,
    };

    if (set.reps === null && set.durationS === null && set.distanceM === null) {
      skipped.push({ line: i + 1, reason: 'no reps, duration or distance', text: name });
      continue;
    }
    session.sets.push(set);
  }

  return {
    source: 'strong',
    sessions: [...sessions.values()].filter((s) => s.sets.length > 0),
    routines: [],
    skipped,
  };
}
