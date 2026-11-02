/**
 * Dates, as the real exports actually write them.
 *
 * The ladder IMPORT.md originally specified — ISO, then dd/MM/yyyy, then
 * MM/dd/yyyy — parses **none** of Hevy's output. Every real Hevy export in
 * `docs/fixtures` uses `30 Jun 2025, 19:56`, so that form leads here.
 *
 * Everything returns epoch **seconds**, and everything is parsed in local time
 * unless the string carries a zone. A workout is a local event; treating a
 * naive timestamp as UTC shifts every session by the offset, which in IST puts
 * evening sessions on the wrong day.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function seconds(date: Date): number | null {
  const time = date.getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

/** `30 Jun 2025, 19:56` — Hevy. */
function parseDayMonthName(text: string): number | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:,)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!m) return null;
  const month = MONTHS[(m[2] ?? '').slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  return seconds(new Date(
    Number(m[3]), month, Number(m[1]),
    Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0),
  ));
}

/** `2020-09-15 11:22:57` (Strong) and `2024-02-01T16:00:00Z` (zoned). */
function parseIso(text: string): number | null {
  // The hour is 1-2 digits: Alpha writes `2025-01-04 9:31 h`, and demanding
  // two digits silently skipped every session before 10am.
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?/.exec(text);
  if (!m) return null;
  if (m[7]) return seconds(new Date(text));   // zoned: let the engine handle it
  return seconds(new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6] ?? 0),
  ));
}

/** `2025-01-07 12:29 h` — Alpha's trailing marker. */
function parseAlpha(text: string): number | null {
  return parseIso(text.replace(/\s*h\s*$/i, ''));
}

/**
 * `dd/MM/yyyy` or `MM/dd/yyyy`. Ambiguous by nature, so the caller passes what
 * the whole file implied rather than guessing per row (IMPORT.md).
 */
function parseSlashed(text: string, dayFirst: boolean): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(text);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const day = dayFirst ? a : b;
  const month = (dayFirst ? b : a) - 1;
  return seconds(new Date(Number(m[3]), month, day, Number(m[4] ?? 0), Number(m[5] ?? 0)));
}

export function parseTimestamp(raw: string, dayFirst = true): number | null {
  const text = raw.replace(/"/g, '').trim();
  if (!text) return null;
  return parseDayMonthName(text)
    ?? parseIso(text)
    ?? parseAlpha(text)
    ?? parseSlashed(text, dayFirst);
}

/**
 * Whether a file's slashed dates are day-first, decided across the whole file:
 * any first component above 12 proves it. Never guessed per row.
 */
export function detectDayFirst(samples: readonly string[]): boolean {
  for (const sample of samples) {
    const m = /^(\d{1,2})\/(\d{1,2})\//.exec(sample.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) return true;
    if (Number(m[2]) > 12) return false;
  }
  return true; // the world's majority, and Strong/Hevy never emit this form
}

/** `1h 43m`, `38min`, `35m`, `1:06 hr`, `49 min` — all seen in the fixtures. */
export function parseDuration(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const text = raw.replace(/"/g, '').trim().toLowerCase();
  if (!text) return null;

  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(hr|h)?$/.exec(text);
  if (clock) {
    return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0);
  }

  let total = 0;
  let matched = false;
  const hours = /(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b/.exec(text);
  if (hours) { total += Number(hours[1]) * 3600; matched = true; }
  const mins = /(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?\b/.exec(text);
  if (mins) { total += Number(mins[1]) * 60; matched = true; }
  const secs = /(\d+)\s*s(?:ec(?:onds?)?)?\b/.exec(text);
  if (secs) { total += Number(secs[1]); matched = true; }

  return matched ? Math.round(total) : null;
}
