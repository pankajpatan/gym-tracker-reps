import {
  adjust, DEFAULT_REST_S, deserialise, formatRemaining, isExpired,
  remaining, restFor, serialise, startRest,
} from '../timer';

describe('rest timer', () => {
  it('is an end timestamp, not a countdown', () => {
    const timer = startRest(1_000, 90, 'Bench Press (Barbell)', 2);
    expect(timer.endsAt).toBe(1_090);
    expect(remaining(timer, 1_030)).toBe(60);
  });

  // The reason it is stored that way at all.
  it('survives a relaunch with the right time left', () => {
    const timer = startRest(1_000, 90, 'Squat (Barbell)', 1);
    const stored = serialise(timer);
    expect(remaining(deserialise(stored, 1_060), 1_060)).toBe(30);
  });

  it('discards a timer that expired while the app was closed', () => {
    const stored = serialise(startRest(1_000, 90, 'Squat (Barbell)', 1));
    expect(deserialise(stored, 5_000)).toBeNull();
  });

  it('survives a corrupted or empty setting', () => {
    expect(deserialise(null, 0)).toBeNull();
    expect(deserialise('', 0)).toBeNull();
    expect(deserialise('not json', 0)).toBeNull();
    expect(deserialise('{"exerciseName":"x"}', 0)).toBeNull();
  });

  it('never reports negative time', () => {
    const timer = startRest(1_000, 30, 'Row', 1);
    expect(remaining(timer, 9_999)).toBe(0);
    expect(isExpired(timer, 9_999)).toBe(true);
  });

  it('adds and subtracts fifteen seconds from the end', () => {
    const timer = startRest(1_000, 90, 'Bench', 1);
    expect(adjust(timer, 1_000, 15)?.endsAt).toBe(1_105);
    expect(adjust(timer, 1_000, -15)?.endsAt).toBe(1_075);
  });

  it('will not push the end into the past', () => {
    const timer = startRest(1_000, 20, 'Bench', 1);
    expect(adjust(timer, 1_015, -60)?.endsAt).toBe(1_016);
  });

  it('formats as mm:ss', () => {
    expect(formatRemaining(90)).toBe('1:30');
    expect(formatRemaining(5)).toBe('0:05');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5)).toBe('0:00');
  });
});

describe('which rest applies', () => {
  it('prefers the exercise override', () => {
    expect(restFor(180, 60)).toBe(180);
  });

  it('falls back to the global default', () => {
    expect(restFor(null, 60)).toBe(60);
  });

  it('falls back to the built-in when nothing is set', () => {
    expect(restFor(null, null)).toBe(DEFAULT_REST_S);
  });

  // "No timer on this exercise" is a real preference, not a missing value.
  it('honours a zero override as no timer at all', () => {
    expect(restFor(0, 90)).toBeNull();
    expect(restFor(null, 0)).toBeNull();
  });
});
