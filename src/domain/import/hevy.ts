/**
 * Hevy CSV (docs/fixtures/hevy-*.csv).
 *
 * 14-col current export:
 *   title,start_time,end_time,description,exercise_title,superset_id,
 *   exercise_notes,set_index,set_type,weight_kg,reps,distance_km,
 *   duration_seconds,rpe
 *
 * A 15-col variant with weight_lbs/distance_miles and a numeric set_type also
 * exists in the wild; it is read where the column names allow, but it is not
 * confirmed to be Hevy's own output.
 *
 * Two facts from the real files that shape this: `set_index` is **0-based**,
 * and `weight_kg` is **empty for bodyweight work** — 281 of 1,922 rows in the
 * fixture. Neither is an error.
 */

import { indexOfHeaders, normaliseHeader, parseRows } from './csv';
import { parseTimestamp } from './dates';
import {
  normaliseSetType, parseNumber, toKilograms,
  type ParsedFile, type ParsedSession, type ParsedSet, type SkippedRow,
} from './types';

export function isHevy(header: readonly string[]): boolean {
  const cells = new Set(normaliseHeader(header));
  return cells.has('exercise_title') && cells.has('start_time') && cells.has('set_type');
}

export function parseHevy(text: string): ParsedFile {
  const rows = parseRows(text);
  const header = normaliseHeader(rows[0] ?? []);
  const at = indexOfHeaders(header);
  const skipped: SkippedRow[] = [];

  const col = (row: string[], name: string): string | undefined => {
    const index = at.get(name);
    return index === undefined ? undefined : row[index];
  };

  const sessions = new Map<string, ParsedSession>();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (row.length === 1 && (row[0] ?? '').trim() === '') continue;

    const rawStart = col(row, 'start_time') ?? '';
    const startedAt = parseTimestamp(rawStart);
    const name = (col(row, 'exercise_title') ?? '').trim();

    if (startedAt === null || name === '') {
      skipped.push({ line: i + 1, reason: startedAt === null ? 'unreadable start_time' : 'no exercise title', text: row.join(',').slice(0, 120) });
      continue;
    }

    const key = rawStart;
    let session = sessions.get(key);
    if (!session) {
      session = {
        startedAt,
        endedAt: parseTimestamp(col(row, 'end_time') ?? ''),
        title: (col(row, 'title') ?? '').trim() || null,
        note: (col(row, 'description') ?? '').trim() || null,
        sets: [],
      };
      sessions.set(key, session);
    }

    // Prefer kg; fall back to the lbs column of the 15-col variant.
    const kg = parseNumber(col(row, 'weight_kg'));
    const lbs = parseNumber(col(row, 'weight_lbs'));
    const weightKg = kg !== null ? kg : toKilograms(lbs, 'lb');

    const km = parseNumber(col(row, 'distance_km'));
    const duration = parseNumber(col(row, 'duration_seconds'));
    const superset = parseNumber(col(row, 'superset_id'));

    const set: ParsedSet = {
      exerciseName: name,
      weightKg: weightKg !== null && weightKg > 0 ? weightKg : null,
      reps: parseNumber(col(row, 'reps')) === null ? null : Math.round(parseNumber(col(row, 'reps')) as number),
      durationS: duration && duration > 0 ? Math.round(duration) : null,
      distanceM: km && km > 0 ? km * 1000 : null,
      type: normaliseSetType(col(row, 'set_type')),
      rpe: parseNumber(col(row, 'rpe')),
      supersetGroup: superset === null ? null : Math.round(superset),
    };

    if (set.reps === null && set.durationS === null && set.distanceM === null) {
      skipped.push({ line: i + 1, reason: 'no reps, duration or distance', text: name });
      continue;
    }
    session.sets.push(set);
  }

  return {
    source: 'hevy',
    sessions: [...sessions.values()].filter((s) => s.sets.length > 0),
    routines: [],
    skipped,
  };
}
