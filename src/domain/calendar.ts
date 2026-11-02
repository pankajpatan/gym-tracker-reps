/**
 * Month grid for the History calendar (UI.md §6).
 *
 * The one thing that matters here is the timezone. Sessions are stored as epoch
 * seconds UTC (SPEC.md), but a calendar is a *local* object — a workout at
 * 00:30 IST is stored on the previous UTC day, and grouping by UTC date would
 * put it on the wrong square. Everything below keys by local date.
 */

export interface DaySquare {
  /** Local `YYYY-MM-DD`; the key sessions are grouped under. */
  readonly key: string;
  readonly day: number;
  /** False for the leading and trailing days that pad the grid. */
  readonly inMonth: boolean;
  readonly isToday: boolean;
}

/** Local date key — never `toISOString()`, which converts to UTC first. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function keyForEpoch(epochSeconds: number): string {
  return dayKey(new Date(epochSeconds * 1000));
}

/**
 * Six weeks of squares, Monday-first, padded from the previous and next month.
 *
 * Always six rows so the grid does not change height as months change — a
 * calendar that jumps between 5 and 6 rows shifts everything under it.
 */
export function monthGrid(year: number, month: number, today = new Date()): DaySquare[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so Monday is 0.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const todayKey = dayKey(today);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dayKey(date);
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      isToday: key === todayKey,
    };
  });
}

/** The epoch range covering a whole local month, for the query. */
export function monthRange(year: number, month: number): { from: number; to: number } {
  return {
    from: Math.floor(new Date(year, month, 1).getTime() / 1000),
    to: Math.floor(new Date(year, month + 1, 1).getTime() / 1000),
  };
}

export function groupByDay<T extends { started_at: number }>(
  rows: readonly T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyForEpoch(row.started_at);
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  }
  return out;
}

export const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Steps a year/month pair, rolling the year over correctly. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}
