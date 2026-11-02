import { DEFAULT_PLATES, describeSide, loadBar, warmupSets } from '../plates';

describe('loading a bar', () => {
  it('solves a common kg loading', () => {
    const l = loadBar(100);
    // Biggest plate first: 25 + 15 a side, not 20 + 20. Same plate count,
    // and it is the order a bar actually gets loaded in.
    expect(l.perSide).toEqual([25, 15]);
    expect(l.achieved).toBe(100);
    expect(l.shortBy).toBe(0);
  });

  it('never uses more plates than the obvious alternative', () => {
    // Every loading the kg set can make, up to 200kg, in two-plate steps.
    for (let target = 22.5; target <= 200; target += 2.5) {
      const l = loadBar(target);
      if (l.shortBy !== 0) continue;
      expect(l.perSide.length).toBeLessThanOrEqual(6);
    }
  });

  it('takes the largest plates first', () => {
    expect(loadBar(140).perSide).toEqual([25, 25, 10]);
  });

  it('uses the small plates for an awkward number', () => {
    const l = loadBar(62.5);
    expect(l.achieved).toBe(62.5);
    expect(l.perSide).toEqual([20, 1.25]);
  });

  it('says bar only when that is the answer', () => {
    expect(loadBar(20).barOnly).toBe(true);
    expect(loadBar(20).perSide).toEqual([]);
  });

  it('handles a target below the bar without inventing negative plates', () => {
    const l = loadBar(10);
    expect(l.perSide).toEqual([]);
    expect(l.achieved).toBe(20);
    expect(l.shortBy).toBe(-10);
  });

  // Being wrong downward is safe; adding weight nobody asked for is not.
  it('lands below an unreachable target and says by how much', () => {
    const l = loadBar(101);
    expect(l.achieved).toBe(100);
    expect(l.shortBy).toBe(1);
  });

  it('solves in pounds with pound plates, not converted kg', () => {
    const l = loadBar(225, DEFAULT_PLATES.lb);
    expect(l.perSide).toEqual([45, 45]);
    expect(l.achieved).toBe(225);
  });

  it('does not accumulate floating-point error', () => {
    const l = loadBar(102.5);
    expect(l.achieved).toBe(102.5);
    expect(l.shortBy).toBe(0);
  });
});

describe('describeSide', () => {
  it('counts repeated plates', () => {
    expect(describeSide([25, 25, 10])).toBe('2 × 25, 1 × 10');
  });

  it('says bar only for nothing', () => {
    expect(describeSide([])).toBe('Bar only');
  });
});

describe('warm-up sets', () => {
  it('climbs from the bar to below the working weight', () => {
    const sets = warmupSets(100);
    expect(sets[0]?.weight).toBe(20);
    expect(sets.every((s) => s.weight < 100)).toBe(true);
    expect(sets.map((s) => s.weight)).toEqual([...sets.map((s) => s.weight)].sort((a, b) => a - b));
  });

  it('drops reps as the weight climbs', () => {
    const reps = warmupSets(100).map((s) => s.reps);
    expect(reps).toEqual([...reps].sort((a, b) => b - a));
  });

  it('carries the loading for each step', () => {
    expect(warmupSets(100)[1]?.loading.perSide.length).toBeGreaterThan(0);
  });

  // At light weights the percentages snap onto the same plates.
  it('never repeats the same weight twice', () => {
    const weights = warmupSets(30).map((s) => s.weight);
    expect(new Set(weights).size).toBe(weights.length);
  });

  it('has nothing to warm up to at or below the bar', () => {
    expect(warmupSets(20)).toEqual([]);
    expect(warmupSets(15)).toEqual([]);
  });

  it('works in pounds', () => {
    const sets = warmupSets(225, DEFAULT_PLATES.lb);
    expect(sets[0]?.weight).toBe(45);
    expect(sets.every((s) => s.weight < 225)).toBe(true);
  });
});
