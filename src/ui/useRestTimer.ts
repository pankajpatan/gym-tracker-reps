/**
 * The rest timer, wired to the database and the phone (F-5).
 *
 * The timer lives in `setting['rest_timer']` as an end timestamp, so the source
 * of truth survives a force-quit exactly as the session does. Everything here
 * is derived from it: the bar, the haptic, and the notification that fires if
 * the app is in the background when rest ends.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSetting, setSetting, type QueryableDatabase } from '../db/queries';
import { haptics, liveActivity, notifications, type LiveActivityState } from './nativeOptional';
import {
  adjust, deserialise, isExpired, remaining, serialise, startRest, type RestTimer,
} from '../domain/timer';

const KEY = 'rest_timer';

/**
 * Sound at the end of a rest, in the foreground as well as the background.
 *
 * iOS delivers a scheduled local notification whether the app is open or not,
 * but **silently while the app is in the foreground** unless a handler says
 * otherwise. So the alert that already exists for the backgrounded case covers
 * the foreground one too — no audio library, no extra native module, and one
 * sound rather than two competing ones.
 *
 * The banner is suppressed while the app is open: the rest bar is already on
 * screen saying the same thing, and a notification card over the input dock
 * would cover the Log set button (UI.md §0 — nothing may block logging).
 */
function installHandler(playSound: boolean): void {
  const Notifications = notifications();
  if (!Notifications?.setNotificationHandler) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: playSound,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    }),
  });
}

export interface RestTimerApi {
  readonly timer: RestTimer | null;
  readonly secondsLeft: number;
  start(durationS: number, exerciseName: string, setNumber: number): Promise<void>;
  add(deltaS: number): Promise<void>;
  skip(): Promise<void>;
}

/**
 * A local notification is scheduled when the rest starts, not when it ends —
 * a backgrounded app gets no timer callback, so the alert has to be already
 * queued with iOS. Skipping or adjusting cancels and reschedules it.
 */
async function scheduleAlert(timer: RestTimer, now: number): Promise<string[]> {
  const seconds = Math.max(1, timer.endsAt - now);
  const Notifications = notifications();
  if (!Notifications) return [];
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      if (!asked.granted) return [];
    } else if (!permission.granted) {
      return [];
    }

    /**
     * **One** notification, not a burst.
     *
     * Three alerts a second apart did make the end of a rest unmissable, and
     * in the background it stacked three banners on the Lock Screen, which is
     * worse than the problem it solved. The urgency has to come from the sound
     * — a single card carrying a three-tone alert — not from repetition.
     *
     * `threadIdentifier` groups successive rests into one stack rather than a
     * list, for the case where one is missed and the next arrives.
     */
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest over',
        body: `${timer.exerciseName} · set ${timer.setNumber + 1}`,
        // The bundled three-tone alert, falling back to the system sound on
        // any build that predates it (scripts/build-sound.py).
        sound: 'rest-over.wav',
        threadIdentifier: 'rest-timer',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
    return [id];
  } catch {
    // Notifications are a convenience here; the in-app bar is the real timer.
    return [];
  }
}

async function cancelAlert(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const Notifications = notifications();
  if (!Notifications) return;
  for (const id of ids) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* already gone */ }
  }
}

/**
 * The Live Activity mirrors the timer onto the Lock Screen and Dynamic Island
 * (F-5). It is fed the same end timestamp the bar is drawn from, so the two
 * cannot disagree — ActivityKit counts down natively from that date, which also
 * means the Lock Screen stays correct without the app running.
 */
function activityState(timer: RestTimer): LiveActivityState {
  return {
    title: timer.exerciseName,
    subtitle: `Set ${timer.setNumber + 1} · resting`,
    progressBar: { date: timer.endsAt * 1000 },
  };
}

export function useRestTimer(
  db: QueryableDatabase | null,
  now: number,
  options: { sound?: boolean } = {},
): RestTimerApi {
  const playSound = options.sound !== false;
  const [timer, setTimer] = useState<RestTimer | null>(null);
  const alertIds = useRef<string[]>([]);
  const firedFor = useRef<number | null>(null);
  const activityId = useRef<string | null>(null);

  /** Ending an activity is best-effort: a stale Lock Screen card is not worth a crash. */
  const endActivity = useCallback((final: RestTimer | null): void => {
    const LiveActivity = liveActivity();
    if (!LiveActivity || !activityId.current) return;
    try {
      LiveActivity.stopActivity(
        activityId.current,
        final ? activityState(final) : { title: 'Rest over', progressBar: {} },
      );
    } catch { /* the activity may already be gone */ }
    activityId.current = null;
  }, []);

  useEffect(() => { installHandler(playSound); }, [playSound]);

  // Restore whatever was running, dropping one that expired while we were away.
  useEffect(() => {
    if (!db) return;
    void (async () => {
      const stored = await getSetting(db, KEY);
      setTimer(deserialise(stored, Math.floor(Date.now() / 1000)));
    })();
  }, [db]);

  const persist = useCallback(async (next: RestTimer | null): Promise<void> => {
    setTimer(next);
    if (db) await setSetting(db, KEY, serialise(next));
  }, [db]);

  const start = useCallback(async (
    durationS: number,
    exerciseName: string,
    setNumber: number,
  ): Promise<void> => {
    const at = Math.floor(Date.now() / 1000);
    const next = startRest(at, durationS, exerciseName, setNumber);
    await cancelAlert(alertIds.current);
    firedFor.current = null;
    await persist(next);
    alertIds.current = await scheduleAlert(next, at);

    const LiveActivity = liveActivity();
    if (LiveActivity) {
      endActivity(null);
      try {
        activityId.current = LiveActivity.startActivity(activityState(next), {
          timerType: 'circular',
          progressViewTint: '#2F6BFF',
        }) ?? null;
      } catch { activityId.current = null; }
    }
  }, [persist, endActivity]);

  const add = useCallback(async (deltaS: number): Promise<void> => {
    const at = Math.floor(Date.now() / 1000);
    const next = adjust(timer, at, deltaS);
    if (!next) return;
    await cancelAlert(alertIds.current);
    await persist(next);
    alertIds.current = await scheduleAlert(next, at);

    const LiveActivity = liveActivity();
    if (LiveActivity && activityId.current) {
      try { LiveActivity.updateActivity(activityId.current, activityState(next)); } catch { /* gone */ }
    }
  }, [timer, persist, endActivity]);

  const skip = useCallback(async (): Promise<void> => {
    await cancelAlert(alertIds.current);
    alertIds.current = [];
    firedFor.current = null;
    endActivity(timer);
    await persist(null);
  }, [persist, endActivity, timer]);

  /**
   * Expiry while the app is open: buzz once, then clear the bar.
   *
   * `firedFor` guards against the haptic repeating every tick — the timer stays
   * on screen for a moment at 0:00 so the end is visible, not just felt.
   */
  useEffect(() => {
    if (!timer || !isExpired(timer, now)) return;
    if (firedFor.current === timer.endsAt) return;
    firedFor.current = timer.endsAt;
    /**
     * Three pulses, not one. A single Success tap is the same feedback the app
     * gives for a saved set, so it does not read as "go" — and through a
     * jacket pocket one tap is easy to miss entirely.
     */
    const Haptics = haptics();
    if (Haptics) {
      const pulse = (): void => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      };
      pulse();
      const second = setTimeout(pulse, 350);
      const third = setTimeout(pulse, 700);
      void second; void third;
    }
    endActivity(timer);
    const clear = setTimeout(() => { void persist(null); }, 2_000);
    return () => clearTimeout(clear);
  }, [timer, now, persist, endActivity]);

  return { timer, secondsLeft: remaining(timer, now), start, add, skip };
}
