import { healthNotice, type HealthNoticeState } from '../health';

const state = (over: Partial<HealthNoticeState> = {}): HealthNoticeState => ({
  available: true, enabled: false, offerDismissed: false, hasFinishedWorkout: true,
  lastFinishedEndedAt: null, lastSavedEndedAt: null, lastError: null, ...over,
});

describe('what Home says about Apple Health', () => {
  // The 2.5.1 rejection: Health was on by nobody and mentioned nowhere a
  // reviewer would look. After a finished workout it must be named.
  it('offers Apple Health once a workout has been finished', () => {
    expect(healthNotice(state())).toEqual({ kind: 'offer' });
  });

  it('offers nothing before anything has been logged', () => {
    expect(healthNotice(state({ hasFinishedWorkout: false }))).toEqual({ kind: 'none' });
  });

  it('respects a dismissed offer', () => {
    expect(healthNotice(state({ offerDismissed: true }))).toEqual({ kind: 'none' });
  });

  it('says nothing on a device without HealthKit', () => {
    expect(healthNotice(state({ available: false, enabled: true }))).toEqual({ kind: 'none' });
  });

  it('confirms the workout just finished was saved', () => {
    expect(healthNotice(state({
      enabled: true, lastFinishedEndedAt: 100, lastSavedEndedAt: 100,
    }))).toEqual({ kind: 'saved' });
  });

  it('does not claim a save that belongs to an earlier workout', () => {
    expect(healthNotice(state({
      enabled: true, lastFinishedEndedAt: 200, lastSavedEndedAt: 100,
    }))).toEqual({ kind: 'on' });
  });

  it('still names Apple Health when on and nothing is written yet', () => {
    expect(healthNotice(state({ enabled: true }))).toEqual({ kind: 'on' });
  });

  // A dismissed offer is about turning it on; it never hides a live integration.
  it('shows the integration when on, even if the offer was dismissed', () => {
    expect(healthNotice(state({ enabled: true, offerDismissed: true }))).toEqual({ kind: 'on' });
  });

  it('shows a failed write with its reason', () => {
    expect(healthNotice(state({ enabled: true, lastError: 'Not authorized' })))
      .toEqual({ kind: 'failed', reason: 'Not authorized' });
  });
});
