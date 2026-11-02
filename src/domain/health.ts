/**
 * What the Workout home says about Apple Health (SPEC.md F-10).
 *
 * App Review rejected 1.0 under guideline 2.5.1: an app using HealthKit must
 * identify that in its interface, and ours did so only in a section of
 * Settings a reviewer never reached. Health is off by default, so a reviewer
 * who logged and finished a workout saw no sign of it anywhere.
 *
 * So Home names Apple Health at the moment it matters — after a workout is
 * finished — and says plainly what happened: saved, not saved, or on offer.
 * The permission sheet is still only shown when the lifter taps to turn it on,
 * never at launch.
 */

export type HealthNotice =
  /** Nothing to say: no HealthKit on this device, or the offer was dismissed. */
  | { kind: 'none' }
  /** Off, and a workout has been finished: offer to turn it on. */
  | { kind: 'offer' }
  /** On, and the workout just finished was written. */
  | { kind: 'saved' }
  /** On, and nothing written this launch yet. */
  | { kind: 'on' }
  /** On, and the last write failed. The reason is shown, not swallowed. */
  | { kind: 'failed'; reason: string };

export interface HealthNoticeState {
  /** HealthKit exists on this device and the native module is present. */
  readonly available: boolean;
  readonly enabled: boolean;
  /** The lifter closed the offer. Settings still has the switch. */
  readonly offerDismissed: boolean;
  /** At least one workout has been finished and saved, ever. */
  readonly hasFinishedWorkout: boolean;
  /** End time of the workout finished this launch, if any. */
  readonly lastFinishedEndedAt: number | null;
  /** End time of the last workout successfully written to Health. */
  readonly lastSavedEndedAt: number | null;
  readonly lastError: string | null;
}

export function healthNotice(state: HealthNoticeState): HealthNotice {
  if (!state.available) return { kind: 'none' };

  if (state.enabled) {
    if (state.lastError !== null) return { kind: 'failed', reason: state.lastError };
    if (state.lastFinishedEndedAt !== null && state.lastSavedEndedAt === state.lastFinishedEndedAt) {
      return { kind: 'saved' };
    }
    return { kind: 'on' };
  }

  // An offer before anything has been logged is a prompt about nothing.
  if (state.offerDismissed || !state.hasFinishedWorkout) return { kind: 'none' };
  return { kind: 'offer' };
}
