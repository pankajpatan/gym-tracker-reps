import {
  MAX_ASKS_PER_YEAR, MIN_DAYS_BETWEEN_ASKS, MIN_SESSIONS, PATIENT_SESSIONS,
  shouldAskForRating, type RatingState,
} from '../rating';

const NOW = 1_800_000_000;
const DAY = 86_400;

const state = (over: Partial<RatingState> = {}): RatingState => ({
  sessionsFinished: 10, lastAskedAt: null, asksThisYear: 0,
  hadPersonalRecord: true, recentFailure: false, ...over,
});

describe('asking for a rating', () => {
  it('asks after a record, once the app has been used a few times', () => {
    expect(shouldAskForRating(state({ sessionsFinished: MIN_SESSIONS }), NOW)).toBe(true);
  });

  // The behaviour the lane is criticised for, and the reason this is a module.
  it('never asks before the app has done anything', () => {
    expect(shouldAskForRating(state({ sessionsFinished: 0 }), NOW)).toBe(false);
    expect(shouldAskForRating(state({ sessionsFinished: MIN_SESSIONS - 1 }), NOW)).toBe(false);
  });

  it('waits for a good moment, but not forever', () => {
    const noRecord = state({ hadPersonalRecord: false, sessionsFinished: PATIENT_SESSIONS - 1 });
    expect(shouldAskForRating(noRecord, NOW)).toBe(false);
    expect(shouldAskForRating({ ...noRecord, sessionsFinished: PATIENT_SESSIONS }, NOW)).toBe(true);
  });

  it('never asks right after something went wrong', () => {
    expect(shouldAskForRating(state({ recentFailure: true }), NOW)).toBe(false);
    // Not even at a record, and not even after many sessions.
    expect(shouldAskForRating(state({ recentFailure: true, sessionsFinished: 50 }), NOW)).toBe(false);
  });

  it('spends Apple\'s three prompts a year slowly', () => {
    expect(shouldAskForRating(state({ asksThisYear: MAX_ASKS_PER_YEAR }), NOW)).toBe(false);
    expect(shouldAskForRating(state({ asksThisYear: MAX_ASKS_PER_YEAR - 1 }), NOW)).toBe(true);
  });

  it('leaves ninety days between prompts', () => {
    const recently = state({ lastAskedAt: NOW - 10 * DAY });
    expect(shouldAskForRating(recently, NOW)).toBe(false);

    const longAgo = state({ lastAskedAt: NOW - (MIN_DAYS_BETWEEN_ASKS + 1) * DAY });
    expect(shouldAskForRating(longAgo, NOW)).toBe(true);
  });

  it('treats the boundary as not yet', () => {
    const exactly = state({ lastAskedAt: NOW - MIN_DAYS_BETWEEN_ASKS * DAY + 1 });
    expect(shouldAskForRating(exactly, NOW)).toBe(false);
  });
});
