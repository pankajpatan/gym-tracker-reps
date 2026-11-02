/**
 * Asking for a rating, at the one moment it is earned.
 *
 * The decision lives in `domain/rating.ts` and is tested there; this hook only
 * keeps the counters and calls Apple. Apple itself decides whether the sheet
 * actually appears — `requestReview` is a request, not a command — which is
 * another reason to spend the opportunities carefully.
 */

import { useCallback } from 'react';
import { getSetting, setSetting, type QueryableDatabase } from '../db/queries';
import { shouldAskForRating } from '../domain/rating';
import { storeReview } from './nativeOptional';

const SESSIONS = 'sessions_finished';
const LAST_ASKED = 'rating_last_asked';
const ASKS = 'rating_asks_this_year';
const ASKS_YEAR = 'rating_asks_year';

export interface RatingApi {
  /** Call after a session is saved. Returns true if a prompt was requested. */
  considerAsking(input: { hadPersonalRecord: boolean; recentFailure: boolean }): Promise<boolean>;
}

export function useRating(db: QueryableDatabase | null): RatingApi {
  const considerAsking = useCallback(async (input: {
    hadPersonalRecord: boolean; recentFailure: boolean;
  }): Promise<boolean> => {
    if (!db) return false;

    const sessionsFinished = Number(await getSetting(db, SESSIONS) ?? '0') + 1;
    await setSetting(db, SESSIONS, String(sessionsFinished));

    const now = Math.floor(Date.now() / 1000);
    const thisYear = new Date(now * 1000).getFullYear();
    const storedYear = Number(await getSetting(db, ASKS_YEAR) ?? '0');
    // The count resets with the calendar year rather than on a rolling window;
    // Apple's cap is rolling, so this is the conservative reading of it.
    const asksThisYear = storedYear === thisYear
      ? Number(await getSetting(db, ASKS) ?? '0')
      : 0;

    const lastAskedRaw = await getSetting(db, LAST_ASKED);

    const ask = shouldAskForRating({
      sessionsFinished,
      lastAskedAt: lastAskedRaw === null ? null : Number(lastAskedRaw),
      asksThisYear,
      hadPersonalRecord: input.hadPersonalRecord,
      recentFailure: input.recentFailure,
    }, now);

    if (!ask) return false;

    const review = storeReview();
    if (!review) return false;
    try {
      if (!(await review.isAvailableAsync())) return false;
      await review.requestReview();
    } catch {
      return false;
    }

    await setSetting(db, LAST_ASKED, String(now));
    await setSetting(db, ASKS, String(asksThisYear + 1));
    await setSetting(db, ASKS_YEAR, String(thisYear));
    return true;
  }, [db]);

  return { considerAsking };
}
