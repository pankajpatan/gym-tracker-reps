/**
 * Alpha Progression (docs/fixtures/alpha-*.csv).
 *
 * **Not a table.** No header row, no fixed columns — a sectioned,
 * semicolon-delimited, BOM-led human-readable report, exported as up to three
 * separate files. It needs a state machine, and detection has to be structural
 * rather than by column names (IMPORT.md, corrected 15 Sep).
 *
 * The workout file's grammar:
 * ```
 * "Lower1 · Day 2 · Week 1 · UpperLower";"2025-01-07 12:29 h";"1:06 hr"   session
 * "1. Sumo Belt Squats · Machine · 15 reps";"optional note"               exercise
 * #;KG;REPS                                                               block columns
 * 1;60;15                                                                 sets
 * ```
 *
 * The `#;…` line declares the columns for the block beneath it and there are
 * six layouts in one real export — `#;KG;REPS`, `#;REPS`, `#;SECS`, `#;MINS`,
 * `#;REPS;MINS`, `#;REPS;SECS`. Reading it is not optional.
 *
 * And the plans file states routines outright, so for Alpha nothing is
 * inferred: `alpha-plans.csv` carries days, exercises and set targets.
 */

import { stripBom } from './csv';
import { parseDuration, parseTimestamp } from './dates';
import {
  parseNumber,
  type ParsedFile, type ParsedRoutine, type ParsedSession, type ParsedSet, type SkippedRow,
} from './types';

const PLAN_HEADER = /^"([^"]+)";(\d{4}-\d{2}-\d{2})/;
const PLAN_DAY = /^"(?:Day\s*\d+\s*·\s*)?([^"]+)"$/i;
const PLAN_EXERCISE = /^"(\d+)\.\s*([^"]+)";"(\d+)\s*sets?";"([^"]*)"/i;

const SESSION_LINE = /^"([^"]*)";"(\d{4}-\d{2}-\d{2}[^"]*)";?"?([^"]*)"?/;
const EXERCISE_LINE = /^"(\d+)\.\s*([^"]+)"(?:;"([^"]*)")?/;
const BLOCK_LINE = /^#;(.+)$/;
const SET_LINE = /^(\d+);(.*)$/;

export function isAlpha(text: string): boolean {
  const lines = stripBom(text).split(/\r?\n/).slice(0, 40).map((line) => line.trim());
  const firstReal = lines.find((line) => line !== '') ?? '';

  return lines.some((line) => SESSION_LINE.test(line))       // workout log
    || lines.some((line) => BLOCK_LINE.test(line))           // its set blocks
    || lines.some((line) => PLAN_EXERCISE.test(line))        // plans file
    || /^"[^"]+";\d{4}-\d{2}-\d{2}\s*$/.test(firstReal)    // plans header
    || /^NAME;EQUIPMENT;MUSCLE/i.test(firstReal);            // custom exercises
}

/**
 * `"1. Sumo Belt Squats · Machine · 15 reps"` → name and equipment.
 * The trailing target ("15 reps") is the plan, not what was done, so it is
 * dropped — the set rows carry the truth.
 */
function splitExercise(label: string): { name: string; equipment: string | null } {
  const parts = label.split('·').map((p) => p.trim()).filter(Boolean);
  const name = parts[0] ?? label.trim();
  const equipment = parts.length > 1 && !/\b(reps?|sec|min)\b/i.test(parts[1] ?? '')
    ? parts[1] ?? null
    : null;
  return { name, equipment };
}

/** `+5` = added to bodyweight, `-` = none, `1:10` = mm:ss on a time metric. */
function parseAlphaValue(raw: string): { number: number | null; seconds: number | null } {
  const text = raw.trim();
  if (text === '' || text === '-') return { number: null, seconds: null };
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [m, s] = text.split(':');
    return { number: null, seconds: Number(m) * 60 + Number(s) };
  }
  return { number: parseNumber(text.replace('+', '')), seconds: null };
}

export function parseAlphaWorkouts(text: string): ParsedFile {
  const lines = stripBom(text).split(/\r?\n/);
  const sessions: ParsedSession[] = [];
  const skipped: SkippedRow[] = [];

  let session: ParsedSession | null = null;
  let exercise: { name: string; note: string | null } | null = null;
  let columns: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (line === '') continue;

    const sessionMatch = SESSION_LINE.exec(line);
    if (sessionMatch) {
      const startedAt = parseTimestamp(sessionMatch[2] ?? '');
      if (startedAt === null) {
        skipped.push({ line: i + 1, reason: 'unreadable session date', text: line.slice(0, 120) });
        session = null;
        continue;
      }
      const duration = parseDuration(sessionMatch[3] ?? '');
      session = {
        startedAt,
        endedAt: duration === null ? null : startedAt + duration,
        title: (sessionMatch[1] ?? '').split('·')[0]?.trim() || null,
        note: null,
        sets: [],
      };
      sessions.push(session);
      exercise = null;
      columns = [];
      continue;
    }

    const exerciseMatch = EXERCISE_LINE.exec(line);
    if (exerciseMatch) {
      const { name } = splitExercise(exerciseMatch[2] ?? '');
      exercise = { name, note: (exerciseMatch[3] ?? '').trim() || null };
      columns = [];
      continue;
    }

    const blockMatch = BLOCK_LINE.exec(line);
    if (blockMatch) {
      columns = (blockMatch[1] ?? '').split(';').map((c) => c.trim().toUpperCase());
      continue;
    }

    const setMatch = SET_LINE.exec(line);
    if (setMatch && session && exercise) {
      const values = (setMatch[2] ?? '').split(';');
      const set: ParsedSet = {
        exerciseName: exercise.name,
        weightKg: null, reps: null, durationS: null, distanceM: null,
        type: 'normal', rpe: null, supersetGroup: null,
      };

      let weight: number | null = null;
      let reps: number | null = null;
      let durationS: number | null = null;

      columns.forEach((column, index) => {
        const cell = values[index];
        if (cell === undefined) return;
        const { number, seconds } = parseAlphaValue(cell);
        if (column === 'KG') weight = number;
        else if (column === 'LB') weight = number === null ? null : number * 0.45359237;
        else if (column === 'REPS') reps = number === null ? null : Math.round(number);
        else if (column === 'SECS') durationS = seconds ?? (number === null ? null : Math.round(number));
        else if (column === 'MINS') durationS = seconds ?? (number === null ? null : Math.round(number * 60));
      });

      const built: ParsedSet = { ...set, weightKg: weight, reps, durationS };
      if (built.reps === null && built.durationS === null) {
        skipped.push({ line: i + 1, reason: 'no reps or duration', text: line.slice(0, 80) });
        continue;
      }
      session.sets.push(built);
      continue;
    }

    if (setMatch) {
      skipped.push({ line: i + 1, reason: 'set outside a session', text: line.slice(0, 80) });
    }
  }

  return {
    source: 'alpha',
    sessions: sessions.filter((s) => s.sets.length > 0),
    routines: [],
    skipped,
  };
}

/**
 * `alpha-plans.csv` — routines stated by the export.
 *
 * This is why Alpha needs no inference: the file says which exercises belong to
 * which day and how many sets each. Hevy drops routines on import; we do not
 * have to reconstruct them here at all.
 */
export function parseAlphaPlans(text: string): ParsedRoutine[] {
  const lines = stripBom(text).split(/\r?\n/);
  const routines: ParsedRoutine[] = [];
  let planName = '';
  let current: { name: string; exerciseNames: string[]; targetSets: number[] } | null = null;

  const flush = (): void => {
    if (current && current.exerciseNames.length > 0) {
      routines.push({ ...current, origin: 'export' });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;

    const planMatch = PLAN_HEADER.exec(line);
    if (planMatch) {
      flush();
      planName = (planMatch[1] ?? '').split('·')[0]?.trim() ?? '';
      continue;
    }

    const exerciseMatch = PLAN_EXERCISE.exec(line);
    if (exerciseMatch && current) {
      const { name } = splitExercise(exerciseMatch[2] ?? '');
      current.exerciseNames.push(name);
      current.targetSets.push(Number(exerciseMatch[3] ?? 3));
      continue;
    }

    const dayMatch = PLAN_DAY.exec(line);
    if (dayMatch && !exerciseMatch) {
      flush();
      const dayName = (dayMatch[1] ?? '').trim();
      current = {
        name: planName ? `${planName} · ${dayName}` : dayName,
        exerciseNames: [],
        targetSets: [],
      };
    }
  }

  flush();
  return routines;
}
