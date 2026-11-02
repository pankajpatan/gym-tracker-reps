/**
 * Apple Health (SPEC.md F-10).
 *
 * **Write only, and nothing is read.** A workout logger has no business
 * reading someone's medical history, and asking for read access would put a
 * permission sheet full of health categories in front of a lifter who wanted a
 * set logger. Requesting only what is used is also how the App Store review
 * guidelines read it.
 *
 * **Permission is asked at first use, never at launch** (SPEC.md). A cold-start
 * permission sheet before anything has been logged is the behaviour reviewers
 * name in one-star reviews of this category.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSetting, setSetting, type QueryableDatabase } from '../db/queries';
import { healthKit } from './nativeOptional';

const ENABLED = 'health_enabled';
const OFFER_DISMISSED = 'health_offer_dismissed';

/**
 * Workouts, and nothing else.
 *
 * Active Energy was in this list and should never have been: we deliberately
 * write no calorie figure, because every estimate of energy burned for lifting
 * is a guess and a health record is the wrong place for one. Asking for a
 * permission we never exercise put a second toggle in front of the lifter for
 * no reason, and Apple's guidance is to request only what is used.
 */
const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier';

/**
 * HealthKit's own numbering for traditional strength training.
 *
 * The first attempt passed `'HKWorkoutActivityTypeTraditionalStrengthTraining'`
 * — the Swift identifier — and HealthKit takes a number. Nothing was written
 * and nothing was said, because the failure was caught and discarded.
 */
const TRADITIONAL_STRENGTH_TRAINING = 50;

export interface HealthApi {
  available: boolean;
  /** The last write failure, so a silent failure becomes a visible one. */
  lastError: string | null;
  /**
   * Held here rather than in each screen, so Home and Settings can never
   * disagree about whether Health is on.
   */
  enabled: boolean;
  /** End time of the last workout written this launch, so Home can say so. */
  lastSavedEndedAt: number | null;
  /** The lifter closed the Home offer. Settings still has the switch. */
  offerDismissed: boolean;
  dismissOffer(): Promise<void>;
  isEnabled(): Promise<boolean>;
  enable(): Promise<boolean>;
  disable(): Promise<void>;
  /** Removes every workout THIS app wrote. Returns how many went. */
  removeOurWorkouts(): Promise<number>;
  /**
   * Best-effort: a failed Health write must never fail a finished workout.
   * `skipped` (Health off or unavailable) is kept apart from `failed`, so a
   * caller can react to this write's outcome without reading `lastError`,
   * which still holds the previous render's value while this one is in flight.
   */
  saveWorkout(input: {
    startedAt: number;
    endedAt: number;
    volumeKg: number;
    sets: number;
  }): Promise<'saved' | 'skipped' | 'failed'>;
}

export function useHealth(db: QueryableDatabase | null): HealthApi {
  const module = healthKit();
  const [lastError, setLastError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [lastSavedEndedAt, setLastSavedEndedAt] = useState<number | null>(null);
  const [offerDismissed, setOfferDismissed] = useState(false);

  useEffect(() => {
    if (!db) return;
    void getSetting(db, ENABLED).then((value) => setEnabled(value === '1'));
    void getSetting(db, OFFER_DISMISSED).then((value) => setOfferDismissed(value === '1'));
  }, [db]);
  const available = module !== null && (() => {
    try { return module.isHealthDataAvailable(); } catch { return false; }
  })();

  const isEnabled = useCallback(async (): Promise<boolean> => {
    if (!db) return false;
    return (await getSetting(db, ENABLED)) === '1';
  }, [db]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!module || !db) return false;
    try {
      // Share only, one type. The read list is deliberately empty.
      const granted = await module.requestAuthorization({
        toShare: [WORKOUT_TYPE],
        toRead: [],
      });
      if (granted) await setSetting(db, ENABLED, '1');
      setEnabled(granted);
      return granted;
    } catch {
      return false;
    }
  }, [module, db]);

  /**
   * Deleting what we wrote.
   *
   * Here because a loop in this app wrote a workout to Health repeatedly, and
   * clearing those by hand in the Health app is slow and easy to get wrong.
   * HealthKit only allows an app to delete its own samples, so this cannot
   * touch a workout logged by a watch or another app.
   */
  const removeOurWorkouts = useCallback(async (): Promise<number> => {
    if (!module?.deleteObjects) return 0;
    try {
      const removed = await module.deleteObjects(WORKOUT_TYPE, {
        date: { from: new Date(2000, 0, 1), to: new Date() },
      });
      setLastError(null);
      return removed;
    } catch (caught) {
      setLastError(caught instanceof Error ? caught.message : String(caught));
      return 0;
    }
  }, [module]);

  const disable = useCallback(async (): Promise<void> => {
    if (db) await setSetting(db, ENABLED, '0');
    setEnabled(false);
  }, [db]);

  const dismissOffer = useCallback(async (): Promise<void> => {
    if (db) await setSetting(db, OFFER_DISMISSED, '1');
    setOfferDismissed(true);
  }, [db]);

  /**
   * One HKWorkout per finished session, as traditional strength training, with
   * our volume in metadata.
   *
   * No energy burned is claimed. Every estimate of calories for lifting is a
   * guess dressed as a measurement, and writing a guess into someone's health
   * record — where other apps will read it as fact — is not a small thing.
   */
  const saveWorkout = useCallback(async (input: {
    startedAt: number; endedAt: number; volumeKg: number; sets: number;
  }): Promise<'saved' | 'skipped' | 'failed'> => {
    if (!module || !(await isEnabled())) return 'skipped';
    try {
      const activityType = module.WorkoutActivityType?.traditionalStrengthTraining
        ?? TRADITIONAL_STRENGTH_TRAINING;

      await module.saveWorkoutSample(
        activityType,
        [],
        new Date(input.startedAt * 1000),
        new Date(input.endedAt * 1000),
        undefined,
        {
          GymTrackerVolumeKg: Math.round(input.volumeKg),
          GymTrackerSets: input.sets,
        },
      );
      // Only touch state when it actually changes: setting it unconditionally
      // re-renders, and this hook's result feeds an effect.
      setLastError((previous) => (previous === null ? previous : null));
      setLastSavedEndedAt(input.endedAt);
      return 'saved';
    } catch (caught) {
      /**
       * A Health failure is still not a logging failure — the workout is in
       * SQLite and that is the record that matters — but it must not be
       * silent. Swallowing this is what made a wrong activity type look like
       * "Health does nothing", with no way to tell why.
       */
      setLastError(caught instanceof Error ? caught.message : String(caught));
      return 'failed';
    }
  }, [module, isEnabled]);

  /**
   * A stable object.
   *
   * Returning a fresh literal every render made this hook's result a new value
   * on every pass, so an effect depending on it re-ran constantly — and since
   * the effect wrote a workout to Health and the write set state, it wrote in
   * an unbounded loop. A hook whose result feeds an effect must be referentially
   * stable.
   */
  return useMemo(
    () => ({
      available, lastError, enabled, lastSavedEndedAt, offerDismissed,
      isEnabled, enable, disable, dismissOffer, saveWorkout, removeOurWorkouts,
    }),
    [
      available, lastError, enabled, lastSavedEndedAt, offerDismissed,
      isEnabled, enable, disable, dismissOffer, saveWorkout, removeOurWorkouts,
    ],
  );
}
