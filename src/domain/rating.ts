/**
 * When to ask for a rating.
 *
 * The rule is: **ask only after the app has demonstrably worked**, and ask
 * rarely. A prompt is asked at a good moment or not at all.
 */

export interface RatingState {
  /** Sessions the lifter has finished and saved, ever. */
  readonly sessionsFinished: number;
  /** Epoch seconds of the last prompt, or null. */
  readonly lastAskedAt: number | null;
  /** Prompts shown in the last 365 days — Apple caps this at 3. */
  readonly asksThisYear: number;
  /** Whether the session just finished set a personal record. */
  readonly hadPersonalRecord: boolean;
  /** Set when something went wrong recently: a failed import, a crash. */
  readonly recentFailure: boolean;
}

/**
 * Two finished sessions before anything is asked: the lifter has come back,
 * which is the earliest proof the app worked. Was 3 and 6 until 1.0.2; at about
 * one download a day, too few people reached session six to be asked at all.
 */
export const MIN_SESSIONS = 2;
/** By this many sessions, ask even without a record to celebrate. */
export const PATIENT_SESSIONS = 4;
/** Apple shows at most three prompts a year; we spend them slowly. */
export const MAX_ASKS_PER_YEAR = 3;
export const MIN_DAYS_BETWEEN_ASKS = 90;

const DAY = 86_400;

export function shouldAskForRating(state: RatingState, now: number): boolean {
  // Never after something has just gone wrong. Asking a lifter to rate the app
  // immediately after an import failed is how one-star reviews are collected.
  if (state.recentFailure) return false;

  if (state.sessionsFinished < MIN_SESSIONS) return false;
  if (state.asksThisYear >= MAX_ASKS_PER_YEAR) return false;

  if (state.lastAskedAt !== null && now - state.lastAskedAt < MIN_DAYS_BETWEEN_ASKS * DAY) {
    return false;
  }

  /**
   * A personal record is the moment the app has just been useful — the number
   * on screen is better than last time and the lifter knows it. Waiting for one
   * costs nothing, because by six sessions we ask regardless: someone training
   * steadily without a PR is still someone the app is working for.
   */
  if (state.hadPersonalRecord) return true;
  return state.sessionsFinished >= PATIENT_SESSIONS;
}
