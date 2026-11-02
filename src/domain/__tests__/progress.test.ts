import {
  bounds, compareToRecent, convertDelta, formatDelta, plot, rollingAverage, series,
  smoothingWindow, type ExerciseSession,
} from '../progress';

const session = (over: Partial<ExerciseSession> = {}): ExerciseSession => ({
  session_id: 1, started_at: 1_000, sets: 3, reps: 24, volume_kg: 1_440,
  top_weight_kg: 60, best_e1rm: 72, ...over,
});

describe('the comparison strip', () => {
  const at = (n: number, over: Partial<ExerciseSession> = {}): ExerciseSession =>
    session({ session_id: n, started_at: n * 1000, ...over });

  it('compares the last session with the average of the previous five', () => {
    const c = compareToRecent([
      at(6, { sets: 5, reps: 40, volume_kg: 2000 }),
      at(5, { sets: 3, reps: 24, volume_kg: 1000 }),
      at(4, { sets: 3, reps: 24, volume_kg: 1000 }),
      at(3, { sets: 3, reps: 24, volume_kg: 1000 }),
      at(2, { sets: 3, reps: 24, volume_kg: 1000 }),
      at(1, { sets: 3, reps: 24, volume_kg: 1000 }),
    ]);
    expect(c?.against).toBe(5);
    expect(c?.sets).toMatchObject({ value: 5, change: 2 });
    expect(c?.volume.change).toBe(1000);
    expect(c?.volume.ratio).toBeCloseTo(1);
  });

  // The reason it changed: one short session made the next look like a win.
  it('is not thrown by a single short session', () => {
    const c = compareToRecent([
      at(5, { volume_kg: 1000 }),
      at(4, { volume_kg: 200 }),     // the short one
      at(3, { volume_kg: 1000 }),
      at(2, { volume_kg: 1000 }),
      at(1, { volume_kg: 1000 }),
    ]);
    // Against the previous session alone this was +400%. Against the last four
    // it is a far smaller, truer number.
    expect(c?.volume.ratio ?? 0).toBeLessThan(0.5);
  });

  it('uses whatever history exists and says how much', () => {
    const c = compareToRecent([at(3, { sets: 4 }), at(2, { sets: 2 }), at(1, { sets: 2 })]);
    expect(c?.against).toBe(2);
    expect(c?.sets.change).toBe(2);
  });

  it('has nothing to compare on a first session', () => {
    const c = compareToRecent([at(1)]);
    expect(c?.against).toBe(0);
    expect(c?.sets).toMatchObject({ change: null, ratio: null });
  });

  it('is null when the exercise has never been trained', () => {
    expect(compareToRecent([])).toBeNull();
  });

  it('survives a previous average of zero', () => {
    const c = compareToRecent([at(2, { volume_kg: 100 }), at(1, { volume_kg: 0 })]);
    expect(c?.volume.change).toBe(100);
    expect(c?.volume.ratio).toBeNull();
  });
});

describe('formatDelta', () => {
  it('reads as an arrow, a size and a percentage', () => {
    expect(formatDelta({ value: 4, change: 1, ratio: 0.333 })).toBe('▲1 (33%)');
    expect(formatDelta({ value: 2, change: -2, ratio: -0.5 })).toBe('▼2 (50%)');
  });

  it('shows a dash rather than a zero change', () => {
    expect(formatDelta({ value: 3, change: 0, ratio: 0 })).toBe('—');
    expect(formatDelta({ value: 3, change: null, ratio: null })).toBe('—');
  });

  // Comparing against an average lands on fractions.
  it('treats a hair of movement as no movement', () => {
    expect(formatDelta({ value: 3, change: 0.02, ratio: 0.006 })).toBe('—');
    expect(formatDelta({ value: 3, change: 0.4, ratio: 0.13 })).toBe('▲0.4 (13%)');
  });
});

describe('chart series', () => {
  const history = [
    session({ started_at: 3_000, volume_kg: 1_800, top_weight_kg: 70, best_e1rm: 80 }),
    session({ started_at: 2_000, volume_kg: 1_600, top_weight_kg: 65, best_e1rm: 76 }),
    session({ started_at: 1_000, volume_kg: 1_440, top_weight_kg: 60, best_e1rm: 72 }),
  ];

  it('comes back oldest first, so the line reads left to right', () => {
    expect(series(history, 'volume').map((p) => p.at)).toEqual([1_000, 2_000, 3_000]);
  });

  it('plots the metric asked for', () => {
    expect(series(history, 'weight').map((p) => p.value)).toEqual([60, 65, 70]);
    expect(series(history, 'e1rm').map((p) => p.value)).toEqual([72, 76, 80]);
  });

  // A bodyweight session has no top weight; drawing it as 0 invents a cliff.
  it('drops sessions with nothing to plot rather than plotting zero', () => {
    const withBodyweight = [...history, session({ started_at: 500, top_weight_kg: null, best_e1rm: null })];
    expect(series(withBodyweight, 'weight')).toHaveLength(3);
    expect(series(withBodyweight, 'volume')).toHaveLength(4);
  });

  it('is empty for an untrained exercise', () => {
    expect(series([], 'volume')).toEqual([]);
  });
});

describe('chart geometry', () => {
  it('pads the axis so the line is not flush to the edges', () => {
    const b = bounds([{ at: 1, value: 100 }, { at: 2, value: 200 }]);
    expect(b.min).toBeLessThan(100);
    expect(b.max).toBeGreaterThan(200);
  });

  it('never pads below zero — a negative axis would be nonsense here', () => {
    // Padding 1 by 10% of the span would give -0.1; it clamps instead.
    expect(bounds([{ at: 1, value: 1 }, { at: 2, value: 2 }]).min).toBe(0.9);
    expect(bounds([{ at: 1, value: 0 }, { at: 2, value: 10 }]).min).toBe(0);
    expect(bounds([{ at: 1, value: 5 }, { at: 2, value: 10 }]).min).toBeGreaterThanOrEqual(0);
  });

  // min === max would divide by zero and the line would vanish.
  it('gives a flat series a band to draw in', () => {
    const b = bounds([{ at: 1, value: 60 }, { at: 2, value: 60 }]);
    expect(b.max).toBeGreaterThan(b.min);
    const points = plot([{ at: 1, value: 60 }, { at: 2, value: 60 }], 100, 50);
    expect(points.every((p) => Number.isFinite(p.y))).toBe(true);
  });

  it('spreads points across the width and inverts y for SVG', () => {
    const points = plot([{ at: 1, value: 0 }, { at: 2, value: 10 }], 100, 50);
    expect(points[0]?.x).toBe(0);
    expect(points[1]?.x).toBe(100);
    expect(points[0]!.y).toBeGreaterThan(points[1]!.y);
  });

  it('centres a single point instead of pinning it to the left edge', () => {
    expect(plot([{ at: 1, value: 60 }], 100, 50)[0]?.x).toBe(50);
  });

  it('plots nothing for an empty series', () => {
    expect(plot([], 100, 50)).toEqual([]);
  });
});

describe('smoothing', () => {
  const points = [10, 20, 30, 40, 50].map((value, index) => ({ at: index, value }));

  it('averages each point with the ones before it', () => {
    const smoothed = rollingAverage(points, 3);
    expect(smoothed[2]?.value).toBe(20);   // (10+20+30)/3
    expect(smoothed[4]?.value).toBe(40);   // (30+40+50)/3
  });

  // A centred window would use sessions that had not happened yet.
  it('never looks forward', () => {
    const smoothed = rollingAverage(points, 3);
    expect(smoothed[0]?.value).toBe(10);
    expect(smoothed[1]?.value).toBe(15);
  });

  it('keeps the original dates', () => {
    expect(rollingAverage(points, 3).map((p) => p.at)).toEqual(points.map((p) => p.at));
  });

  it('starts at the first session rather than after a gap', () => {
    expect(rollingAverage(points, 5)).toHaveLength(points.length);
  });

  it('is a no-op for a window of one', () => {
    expect(rollingAverage(points, 1)).toEqual(points);
  });

  it('survives an empty series', () => {
    expect(rollingAverage([], 3)).toEqual([]);
  });

  it('flattens a spike without erasing the direction', () => {
    const spiky = [100, 100, 500, 100, 100].map((value, index) => ({ at: index, value }));
    const smoothed = rollingAverage(spiky, 3);
    expect(Math.max(...smoothed.map((p) => p.value))).toBeLessThan(500);
    expect(Math.max(...smoothed.map((p) => p.value))).toBeGreaterThan(100);
  });

  it('does not smooth a history too short to have a trend', () => {
    expect(smoothingWindow(0)).toBe(1);
    expect(smoothingWindow(5)).toBe(1);
    expect(smoothingWindow(6)).toBe(3);
    expect(smoothingWindow(20)).toBe(5);
  });
});

describe('deltas in the lifter\'s unit', () => {
  const kgToLb = (value: number): number => value / 0.45359237;

  // The tell was that the same "▲44" appeared under both kg and lb.
  it('converts the change as well as the value', () => {
    const converted = convertDelta({ value: 1260, change: 44, ratio: 0.04 }, kgToLb);
    expect(converted.value).toBeCloseTo(2777.8, 1);
    expect(converted.change).toBeCloseTo(97, 0);
  });

  it('leaves the ratio alone, because a percentage has no unit', () => {
    expect(convertDelta({ value: 100, change: 10, ratio: 0.1 }, kgToLb).ratio).toBe(0.1);
  });

  it('passes a missing change through untouched', () => {
    expect(convertDelta({ value: 10, change: null, ratio: null }, kgToLb).change).toBeNull();
  });

  it('drops the decimal once the number is large', () => {
    expect(formatDelta({ value: 2778, change: 97, ratio: 0.04 })).toBe('▲97 (4%)');
    expect(formatDelta({ value: 2778, change: 1240, ratio: 0.8 })).toBe('▲1,240 (80%)');
  });

  it('keeps the decimal where a tenth still means something', () => {
    expect(formatDelta({ value: 4, change: 0.8, ratio: 0.25 })).toBe('▲0.8 (25%)');
  });
});
