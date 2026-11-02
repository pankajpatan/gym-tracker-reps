import { e1rm, personalRecords, volume, type SetRow } from '../derive';

const set = (over: Partial<SetRow> = {}): SetRow => ({
  exercise_id: 1, weight_kg: 100, reps: 5, type: 'normal', done_at: 1000, ...over,
});

describe('e1rm', () => {
  it('uses Epley by default', () => {
    expect(e1rm(100, 5)).toBeCloseTo(100 * (1 + 5 / 30));
  });

  it('returns the weight itself for a single rep, under either formula', () => {
    expect(e1rm(140, 1)).toBe(140);
    expect(e1rm(140, 1, 'brzycki')).toBe(140);
  });

  it('computes Brzycki when asked', () => {
    expect(e1rm(100, 10, 'brzycki')).toBeCloseTo(100 * (36 / 27));
  });

  it('refuses rather than inventing a number where Brzycki breaks down', () => {
    expect(e1rm(100, 37, 'brzycki')).toBeNull();
    expect(e1rm(100, 50, 'brzycki')).toBeNull();
  });

  it('rejects non-positive input', () => {
    expect(e1rm(0, 5)).toBeNull();
    expect(e1rm(100, 0)).toBeNull();
    expect(e1rm(-5, 5)).toBeNull();
  });
});

describe('volume', () => {
  it('sums working sets', () => {
    expect(volume([set(), set({ weight_kg: 50, reps: 10 })])).toBe(1000);
  });

  it('excludes warm-ups', () => {
    expect(volume([set(), set({ type: 'warmup', weight_kg: 999, reps: 1 })])).toBe(500);
  });

  it('counts a bodyweight set as zero rather than guessing a bodyweight', () => {
    expect(volume([set({ weight_kg: null, reps: 10 })])).toBe(0);
  });

  it('is zero for an empty session', () => {
    expect(volume([])).toBe(0);
  });
});

describe('personalRecords', () => {
  it('finds the best set for each kind', () => {
    const records = personalRecords(1, [
      set({ weight_kg: 100, reps: 5, done_at: 1 }),
      set({ weight_kg: 120, reps: 1, done_at: 2 }),
      set({ weight_kg: 60, reps: 20, done_at: 3 }),
    ]);
    const by = Object.fromEntries(records.map((r) => [r.kind, r.value]));
    expect(by.weight).toBe(120);
    expect(by.reps).toBe(20);
    expect(by.volume).toBe(1200);             // 60 x 20
    // The 120kg single beats 60x20 (100kg estimated) — the heavy set wins.
    expect(by.e1rm).toBeCloseTo(120);
  });

  it('never records a warm-up', () => {
    const records = personalRecords(1, [
      set({ weight_kg: 300, reps: 1, type: 'warmup', done_at: 1 }),
      set({ weight_kg: 100, reps: 5, done_at: 2 }),
    ]);
    expect(records.find((r) => r.kind === 'weight')?.value).toBe(100);
  });

  it('keeps the earlier set when two tie, so re-importing does not move dates', () => {
    const records = personalRecords(1, [
      set({ weight_kg: 100, reps: 5, done_at: 500 }),
      set({ weight_kg: 100, reps: 5, done_at: 900 }),
    ]);
    expect(records.find((r) => r.kind === 'weight')?.achieved_at).toBe(500);
  });

  it('records reps for bodyweight work that has no weight', () => {
    const records = personalRecords(1, [set({ weight_kg: null, reps: 12 })]);
    expect(records.map((r) => r.kind).sort()).toEqual(['reps']);
    expect(records[0]?.value).toBe(12);
  });

  it('returns nothing for a session of warm-ups', () => {
    expect(personalRecords(1, [set({ type: 'warmup' })])).toEqual([]);
  });
});
