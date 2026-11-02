/**
 * Rest timer (F-5, SPEC.md).
 *
 * The timer is **not a countdown held in memory**. It is an end timestamp
 * written to the `setting` table, and everything on screen is derived from it
 * against the current clock. That is what makes "relaunch restores the running
 * timer's remaining time" true rather than approximately true (UI.md §3.4) —
 * a JS interval dies with the process, an epoch second does not.
 *
 * Pure: no database, no Expo, no clock of its own. The caller passes `now`.
 */

export interface RestTimer {
  /** Epoch seconds when the rest ends. */
  readonly endsAt: number;
  /** What was being rested from — shown on the bar and the Live Activity. */
  readonly exerciseName: string;
  /** The set just completed, e.g. 2. */
  readonly setNumber: number;
  /** The duration it was started with, so +15/−15 can be reasoned about. */
  readonly durationS: number;
}

export const DEFAULT_REST_S = 90;

/** A timer stops existing once it has been consumed; null means "no rest running". */
export function startRest(
  now: number,
  durationS: number,
  exerciseName: string,
  setNumber: number,
): RestTimer {
  const safe = Math.max(1, Math.round(durationS));
  return { endsAt: now + safe, exerciseName, setNumber, durationS: safe };
}

/** Seconds left, never negative. Zero means the rest is over. */
export function remaining(timer: RestTimer | null, now: number): number {
  if (!timer) return 0;
  return Math.max(0, timer.endsAt - now);
}

export function isExpired(timer: RestTimer | null, now: number): boolean {
  return timer !== null && remaining(timer, now) === 0;
}

/**
 * `−15` and `+15` shift the end, not the original duration.
 *
 * Adjusting below the current moment would mean "the rest ended in the past",
 * which reads as a timer that vanished rather than one that finished — so the
 * floor is now + 1 second, letting the normal expiry path fire the haptic.
 */
export function adjust(timer: RestTimer | null, now: number, deltaS: number): RestTimer | null {
  if (!timer) return null;
  return { ...timer, endsAt: Math.max(now + 1, timer.endsAt + deltaS) };
}

/** `mm:ss`, the only format the bar ever shows. */
export function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Which rest applies to the set just logged: the routine's per-exercise
 * override, else the global default, else the built-in.
 *
 * A zero or negative override means "no rest timer for this exercise" and is
 * honoured — some lifters do not want one on accessory work, and silently
 * substituting the default would be the app arguing with them.
 */
export function restFor(
  exerciseOverrideS: number | null | undefined,
  globalDefaultS: number | null | undefined,
): number | null {
  if (exerciseOverrideS !== null && exerciseOverrideS !== undefined) {
    return exerciseOverrideS > 0 ? exerciseOverrideS : null;
  }
  if (globalDefaultS !== null && globalDefaultS !== undefined) {
    return globalDefaultS > 0 ? globalDefaultS : null;
  }
  return DEFAULT_REST_S;
}

/** Serialised into `setting['rest_timer']` — small enough to be one row. */
export function serialise(timer: RestTimer | null): string {
  return timer === null ? '' : JSON.stringify(timer);
}

/**
 * Reads a timer back, discarding one that already expired while the app was
 * closed — coming back after lunch should not show a finished rest.
 */
export function deserialise(value: string | null, now: number): RestTimer | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<RestTimer>;
    if (typeof parsed.endsAt !== 'number') return null;
    const timer: RestTimer = {
      endsAt: parsed.endsAt,
      exerciseName: parsed.exerciseName ?? '',
      setNumber: parsed.setNumber ?? 0,
      durationS: parsed.durationS ?? DEFAULT_REST_S,
    };
    return remaining(timer, now) > 0 ? timer : null;
  } catch {
    return null;
  }
}
