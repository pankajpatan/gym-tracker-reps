import {
  dayKey, groupByDay, keyForEpoch, monthGrid, monthLabel, monthRange, shiftMonth,
} from '../calendar';

describe('local date keys', () => {
  // The bug this prevents: toISOString() converts to UTC, so a late-evening
  // session in IST lands on the following day's square.
  it('keys by the local day, not the UTC day', () => {
    const lateEvening = new Date(2026, 8, 15, 23, 30);
    expect(dayKey(lateEvening)).toBe('2026-09-15');
  });

  it('keys an early-morning session to the day it was trained', () => {
    const earlyMorning = new Date(2026, 8, 16, 0, 30);
    expect(dayKey(earlyMorning)).toBe('2026-09-16');
  });

  it('round-trips an epoch through the local key', () => {
    const date = new Date(2026, 0, 5, 12, 0);
    expect(keyForEpoch(Math.floor(date.getTime() / 1000))).toBe('2026-01-05');
  });

  it('pads single digits', () => {
    expect(dayKey(new Date(2026, 0, 2))).toBe('2026-01-02');
  });
});

describe('month grid', () => {
  it('is always six weeks so the layout never jumps', () => {
    expect(monthGrid(2026, 8)).toHaveLength(42);
    expect(monthGrid(2026, 1)).toHaveLength(42);
  });

  it('starts on a Monday', () => {
    const grid = monthGrid(2026, 8);
    expect(new Date(`${grid[0]?.key}T00:00:00`).getDay()).toBe(1);
  });

  it('marks which squares belong to the month', () => {
    const grid = monthGrid(2026, 8); // September 2026, 30 days
    expect(grid.filter((d) => d.inMonth)).toHaveLength(30);
  });

  it('marks today', () => {
    const today = new Date(2026, 8, 15);
    const grid = monthGrid(2026, 8, today);
    expect(grid.filter((d) => d.isToday).map((d) => d.key)).toEqual(['2026-09-15']);
  });

  it('marks no square as today when looking at another month', () => {
    expect(monthGrid(2025, 0, new Date(2026, 8, 15)).some((d) => d.isToday)).toBe(false);
  });

  it('handles a leap February', () => {
    expect(monthGrid(2028, 1).filter((d) => d.inMonth)).toHaveLength(29);
  });
});

describe('month navigation and range', () => {
  it('rolls the year over in both directions', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('covers exactly one local month', () => {
    const { from, to } = monthRange(2026, 8);
    expect(new Date(from * 1000).getDate()).toBe(1);
    expect(new Date(to * 1000).getDate()).toBe(1);
    expect(to).toBeGreaterThan(from);
  });

  it('labels the month readably', () => {
    expect(monthLabel(2026, 8)).toMatch(/2026/);
  });
});

describe('grouping sessions onto squares', () => {
  it('collects sessions by their local day', () => {
    const morning = Math.floor(new Date(2026, 8, 15, 7, 0).getTime() / 1000);
    const evening = Math.floor(new Date(2026, 8, 15, 19, 0).getTime() / 1000);
    const nextDay = Math.floor(new Date(2026, 8, 16, 7, 0).getTime() / 1000);

    const grouped = groupByDay([
      { started_at: morning }, { started_at: evening }, { started_at: nextDay },
    ]);
    expect(grouped.get('2026-09-15')).toHaveLength(2);
    expect(grouped.get('2026-09-16')).toHaveLength(1);
  });

  it('is empty for no sessions', () => {
    expect(groupByDay([]).size).toBe(0);
  });
});
