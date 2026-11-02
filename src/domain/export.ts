/**
 * CSV export (UI.md §7, F-10).
 *
 * **It emits Strong's column layout, not a format of our own.**
 *
 * That is a deliberate anti-lock-in choice. Strong's CSV is the one format this
 * category actually reads — Hevy's importer accepts it, ours does, and it is
 * the shape every converter script on GitHub expects. Inventing a private
 * format would mean a lifter's data leaves this app only into this app, which
 * is exactly the trap the import wedge exists to attack. Charging for the exit
 * would be worse.
 *
 * It also gives a free correctness check: our own export parses back through
 * `parseStrong`, so a round trip is testable rather than asserted.
 */

export interface ExportSet {
  readonly started_at: number;
  readonly session_name: string | null;
  readonly duration_s: number | null;
  readonly exercise_name: string;
  readonly position: number;
  readonly weight_kg: number | null;
  readonly reps: number | null;
  readonly distance_m: number | null;
  readonly duration_set_s: number | null;
  readonly note: string | null;
  readonly session_note: string | null;
  readonly rpe: number | null;
}

export const EXPORT_HEADER = [
  'Date', 'Workout Name', 'Duration', 'Exercise Name', 'Set Order', 'Weight',
  'Reps', 'Distance', 'Seconds', 'Notes', 'Workout Notes', 'RPE',
] as const;

/** `2020-09-15 11:22:57` in **local** time, which is how Strong writes it. */
export function formatDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** `1h 43m` / `38m`, Strong's forms. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Quotes a cell the way a CSV reader expects, including ours.
 *
 * Exercise names contain commas (`Bench Press (Barbell), Close Grip`) and notes
 * contain newlines and quotes, so this is not optional politeness.
 */
export function quote(value: string): string {
  if (value === '') return '';
  const escaped = value.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function number(value: number | null, fallback = '0'): string {
  return value === null ? fallback : String(Math.round(value * 100) / 100);
}

export function toCsv(rows: readonly ExportSet[]): string {
  const lines = [EXPORT_HEADER.join(',')];

  for (const row of rows) {
    lines.push([
      formatDate(row.started_at),
      quote(row.session_name ?? ''),
      formatDuration(row.duration_s),
      quote(row.exercise_name),
      String(row.position),
      // A bodyweight set has no weight; Strong writes 0 there, and writing
      // anything else would make the file unreadable by the apps that matter.
      number(row.weight_kg),
      number(row.reps),
      number(row.distance_m),
      number(row.duration_set_s),
      quote(row.note ?? ''),
      quote(row.session_note ?? ''),
      row.rpe === null ? '' : String(row.rpe),
    ].join(','));
  }

  return `${lines.join('\n')}\n`;
}

/** `gym-tracker-2026-09-16.csv` — dated, so two exports never collide. */
export function exportFilename(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `gym-tracker-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
