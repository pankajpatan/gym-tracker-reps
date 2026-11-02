import type { SetRow } from '../derive';
import {
  dockSeed, formatDuration, nextIncompleteIndex, rebuildSession, sessionTotals,
} from '../session';
import { formatWeight, fromKg, toKg, weightChips } from '../units';

const set = (over: Partial<SetRow> = {}): SetRow => ({
  exercise_id: 1, weight_kg: 60, reps: 10, type: 'normal', done_at: 0, ...over,
});

describe('session totals', () => {
  it('counts every set but excludes warm-ups from volume', () => {
    const totals = sessionTotals([set(), set({ type: 'warmup', weight_kg: 200, reps: 1 })], 0, 75);
    expect(totals.volumeKg).toBe(600);
    expect(totals.sets).toBe(2);
    expect(totals.durationS).toBe(75);
  });

  it('never reports a negative duration if the clock moves backwards', () => {
    expect(sessionTotals([], 500, 100).durationS).toBe(0);
  });
});

describe('formatDuration', () => {
  it('reads as m:ss under an hour', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(5)).toBe('0:05');
  });

  it('adds hours once it passes one', () => {
    expect(formatDuration(3750)).toBe('1:02:30');
  });
});

describe('focus after logging', () => {
  const rows = (...done: boolean[]) => done.map((d) => ({ done: d }));

  it('moves to the next incomplete row', () => {
    expect(nextIncompleteIndex(rows(true, false, false), 0)).toBe(1);
  });

  it('wraps back to a row that was skipped', () => {
    expect(nextIncompleteIndex(rows(false, true, true), 2)).toBe(0);
  });

  it('returns null when the exercise is finished', () => {
    expect(nextIncompleteIndex(rows(true, true), 1)).toBeNull();
  });
});

describe('units', () => {
  it('round-trips through lb', () => {
    expect(toKg(fromKg(100, 'lb'), 'lb')).toBeCloseTo(100, 9);
  });

  it('drops a trailing .0 so columns read cleanly', () => {
    expect(formatWeight(65, 'kg')).toBe('65');
    expect(formatWeight(62.5, 'kg')).toBe('62.5');
  });

  it('shows plate-sized chips per unit', () => {
    expect(weightChips('kg')).toEqual([1, 2.5, 5, 10, 20, 25]);
    expect(weightChips('lb')).toEqual([2.5, 5, 10, 25, 45, 100]);
  });
});

/**
 * The resume path, which a device found broken: the sets were on disk and the
 * screen still said "Add your first exercise". Tested here because the bug was
 * never in SQLite — it was in not rebuilding from it.
 */
describe('rebuildSession (F-4)', () => {
  const meta = new Map([
    [1, { id: 1, name: 'Bench Press (Barbell)', muscle: 'chest' }],
    [2, { id: 2, name: 'Squat (Barbell)', muscle: 'quadriceps' }],
  ]);
  const stored = [
    { exercise_id: 1, weight_kg: 60, reps: 10, type: 'normal' },
    { exercise_id: 1, weight_kg: 60, reps: 8, type: 'normal' },
    { exercise_id: 2, weight_kg: 100, reps: 5, type: 'normal' },
  ];

  it('rebuilds every exercise that was logged', () => {
    const rebuilt = rebuildSession(stored, meta);
    expect(rebuilt.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Squat (Barbell)']);
  });

  it('marks the logged sets done and keeps their values', () => {
    const [bench] = rebuildSession(stored, meta);
    expect(bench?.rows.slice(0, 2)).toEqual([
      expect.objectContaining({ done: true, weightKg: 60, reps: 10 }),
      expect.objectContaining({ done: true, weightKg: 60, reps: 8 }),
    ]);
  });

  it('leaves one empty row ready to continue on', () => {
    const [bench] = rebuildSession(stored, meta);
    expect(bench?.rows.at(-1)).toEqual(expect.objectContaining({ done: false, weightKg: null }));
  });

  it('keeps the order the exercises were logged in', () => {
    const reversed = [...stored].reverse();
    expect(rebuildSession(reversed, meta)[0]?.exerciseId).toBe(2);
  });

  it('survives an exercise row that has since been archived', () => {
    const rebuilt = rebuildSession(stored, new Map());
    expect(rebuilt[0]?.name).toBe('Exercise 1');
  });

  it('returns nothing for a session with no sets yet', () => {
    expect(rebuildSession([], meta)).toEqual([]);
  });
});

describe('dockSeed — why logging is two taps', () => {
  const row = (over = {}) => ({ weightKg: null, reps: null, previous: null, ...over });

  it('carries the set just logged forward to the next row', () => {
    expect(dockSeed(row(), { weightKg: 60, reps: 10 })).toEqual({ weight: 60, reps: 10 });
  });

  it('prefers the row\'s own values over anything carried', () => {
    expect(dockSeed(row({ weightKg: 70, reps: 5 }), { weightKg: 60, reps: 10 }))
      .toEqual({ weight: 70, reps: 5 });
  });

  it('falls back to the PREVIOUS column when nothing has been logged yet', () => {
    expect(dockSeed(row({ previous: { weightKg: 62, reps: 7 } }), null))
      .toEqual({ weight: 62, reps: 7 });
  });

  it('is empty only when there is genuinely nothing to show', () => {
    expect(dockSeed(row(), null)).toEqual({ weight: null, reps: null });
  });
});

/**
 * The dock works in the DISPLAYED unit and the database stores kilograms.
 * These pin the round trip, because getting it wrong stores pounds as
 * kilograms and silently inflates every record by 2.2x.
 */
describe('unit round trip through the dock', () => {
  it('shows a stored kilogram weight in pounds', () => {
    expect(Math.round(fromKg(100, 'lb'))).toBe(220);
  });

  it('stores a pound entry back as kilograms', () => {
    expect(toKg(225, 'lb')).toBeCloseTo(102.06, 2);
  });

  it('survives the round trip without drift', () => {
    for (const weight of [20, 60, 62.5, 100, 142.5]) {
      expect(toKg(fromKg(weight, 'lb'), 'lb')).toBeCloseTo(weight, 9);
    }
  });

  it('leaves kilograms untouched', () => {
    expect(toKg(62.5, 'kg')).toBe(62.5);
    expect(fromKg(62.5, 'kg')).toBe(62.5);
  });
});
