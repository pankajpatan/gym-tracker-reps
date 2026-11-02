/**
 * Progress readouts: the comparison strip and the chart series (F-7).
 *
 * Pure functions over the per-session rows `exerciseHistory` returns, so both
 * the numbers and the shape of the line are testable without a device.
 */

export interface ExerciseSession {
  readonly session_id: number;
  readonly started_at: number;
  readonly sets: number;
  readonly reps: number;
  readonly volume_kg: number;
  readonly top_weight_kg: number | null;
  readonly best_e1rm: number | null;
}

export interface Delta {
  readonly value: number;
  readonly change: number | null;
  /** Fractional change, null when there is nothing to compare against. */
  readonly ratio: number | null;
}

export interface Comparison {
  readonly sets: Delta;
  readonly reps: Delta;
  readonly volume: Delta;
}

function delta(current: number, previous: number | undefined): Delta {
  if (previous === undefined) return { value: current, change: null, ratio: null };
  const change = current - previous;
  return { value: current, change, ratio: previous === 0 ? null : change / previous };
}

export interface RecentComparison extends Comparison {
  /** How many previous sessions the average was taken over, for the label. */
  readonly against: number;
}

/**
 * The comparison strip (UI.md §4): this session against the average of the
 * sessions before it.
 *
 * Originally the immediately preceding session, which is Setgraph's pattern.
 * On a real imported history that proved too jumpy to mean anything — one
 * short session makes the next one look like a 25% improvement. A five-session
 * baseline answers the question the lifter is actually asking, which is whether
 * this session was good *for them*, not whether it beat one arbitrary day.
 *
 * The window shrinks to whatever history exists, and the label says what it
 * compared against so the number is never unexplained.
 *
 * `history` is newest-first, as the query returns it.
 */
export function compareToRecent(
  history: readonly ExerciseSession[],
  window = 5,
): RecentComparison | null {
  const latest = history[0];
  if (!latest) return null;

  const previous = history.slice(1, 1 + window);
  if (previous.length === 0) {
    return {
      sets: delta(latest.sets, undefined),
      reps: delta(latest.reps, undefined),
      volume: delta(latest.volume_kg, undefined),
      against: 0,
    };
  }

  const mean = (pick: (s: ExerciseSession) => number): number =>
    previous.reduce((total, session) => total + pick(session), 0) / previous.length;

  return {
    sets: delta(latest.sets, mean((s) => s.sets)),
    reps: delta(latest.reps, mean((s) => s.reps)),
    volume: delta(latest.volume_kg, mean((s) => s.volume_kg)),
    against: previous.length,
  };
}

/**
 * Rescales a delta into the displayed unit.
 *
 * The strip showed `▲44` beside a pounds figure because only the *value* was
 * converted and the change was left in kilograms — the same number appeared
 * under both units, which is the tell.
 */
export function convertDelta(d: Delta, convert: (value: number) => number): Delta {
  return {
    value: convert(d.value),
    change: d.change === null ? null : convert(d.change),
    ratio: d.ratio,   // a ratio is unitless and must not be converted
  };
}

/** `▲1 (33%)` / `▼2 (12%)` / `—` when there is nothing to compare. */
export function formatDelta(d: Delta): string {
  if (d.change === null) return '—';
  // A comparison against an average lands on fractions; anything under a tenth
  // is noise dressed as a result.
  if (Math.abs(d.change) < 0.05) return '—';
  const arrow = d.change > 0 ? '▲' : '▼';
  // Big numbers do not need a decimal; small ones do. A tenth of a kilo is
  // noise, a tenth of a set is not.
  const magnitude = Math.abs(d.change);
  const size = magnitude >= 100
    ? Math.round(magnitude).toLocaleString()
    : Math.round(magnitude * 10) / 10;
  const percent = d.ratio === null ? '' : ` (${Math.abs(Math.round(d.ratio * 100))}%)`;
  return `${arrow}${size}${percent}`;
}

export type Metric = 'volume' | 'weight' | 'e1rm';

export interface Point {
  readonly at: number;
  readonly value: number;
}

/**
 * A chart series, oldest first, with sessions that have nothing to plot for
 * the chosen metric dropped rather than drawn as zero.
 *
 * A bodyweight session has no top weight; plotting it as 0 would draw a cliff
 * the lifter never trained.
 */
export function series(
  history: readonly ExerciseSession[],
  metric: Metric,
): Point[] {
  const points: Point[] = [];
  for (const row of [...history].reverse()) {
    const value = metric === 'volume'
      ? row.volume_kg
      : metric === 'weight'
        ? row.top_weight_kg
        : row.best_e1rm;
    if (value === null || value === undefined) continue;
    if (metric !== 'volume' && value <= 0) continue;
    points.push({ at: row.started_at, value });
  }
  return points;
}

export interface Bounds {
  readonly min: number;
  readonly max: number;
}

/**
 * Y-axis bounds with a little headroom.
 *
 * A flat series (every session identical) would otherwise give min === max and
 * a division by zero in the plot; it is given an artificial band so the line
 * draws through the middle instead of disappearing.
 */
export function bounds(points: readonly Point[]): Bounds {
  if (points.length === 0) return { min: 0, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.1;
  return { min: Math.max(0, min - pad), max: max + pad };
}

/** Points mapped into a box, ready for an SVG polyline. */
export function plot(
  points: readonly Point[],
  width: number,
  height: number,
): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const { min, max } = bounds(points);
  const span = max - min || 1;
  if (points.length === 1) {
    return [{ x: width / 2, y: height - ((points[0]!.value - min) / span) * height }];
  }
  return points.map((point, index) => ({
    x: (index / (points.length - 1)) * width,
    y: height - ((point.value - min) / span) * height,
  }));
}

/**
 * A trailing rolling average, for the charts.
 *
 * Session-to-session volume is genuinely noisy — a short session, a deload, a
 * day you cut it short — and plotted raw the variation dominates the trend,
 * which is the only thing anyone opens a chart to see.
 *
 * **Trailing, not centred.** Each point averages itself and the sessions
 * before it, so the line never uses a workout that had not happened yet. A
 * centred window looks smoother and quietly implies foreknowledge, which on a
 * progress chart is a lie about the past.
 *
 * Early points average over however many sessions exist, so the line starts at
 * the first session rather than after a gap.
 */
export function rollingAverage(points: readonly Point[], window = 3): Point[] {
  if (window <= 1) return [...points];

  return points.map((point, index) => {
    const from = Math.max(0, index - window + 1);
    const slice = points.slice(from, index + 1);
    const total = slice.reduce((sum, p) => sum + p.value, 0);
    return { at: point.at, value: total / slice.length };
  });
}

/**
 * How much smoothing a series deserves.
 *
 * Below six sessions there is no trend to find and averaging only hides the
 * few real numbers, so the raw series is returned untouched.
 */
export function smoothingWindow(count: number): number {
  if (count < 6) return 1;
  if (count < 14) return 3;
  return 5;
}
