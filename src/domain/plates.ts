/**
 * Plate and warm-up calculators (F-8).
 *
 * Available to everyone, with nothing gated.
 *
 * Everything is computed in the **displayed** unit, not in kg. A lifter loading
 * a bar in a US gym is putting 45lb plates on a 45lb bar; converting to kg,
 * solving, and converting back would produce 20.41kg plates that do not exist.
 * This is the one place in the app where lb is not immediately converted away.
 */

import type { Unit } from './units';

export interface PlateSet {
  /** Plate denominations, largest first, in the displayed unit. */
  readonly plates: readonly number[];
  readonly bar: number;
}

/** What a commercial gym has on the rack, in each unit. */
export const DEFAULT_PLATES: Readonly<Record<Unit, PlateSet>> = {
  kg: { plates: [25, 20, 15, 10, 5, 2.5, 1.25], bar: 20 },
  lb: { plates: [45, 35, 25, 10, 5, 2.5], bar: 45 },
};

export interface Loading {
  /** Plates for ONE side, largest first — the side you actually load. */
  readonly perSide: number[];
  /** The weight these plates plus the bar actually make. */
  readonly achieved: number;
  /** Requested minus achieved; non-zero when the plates cannot make it exactly. */
  readonly shortBy: number;
  /** True when the target is below the bar, or the bar alone is the answer. */
  readonly barOnly: boolean;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Which plates to put on one side.
 *
 * Greedy largest-first. That is NOT provably optimal — 25 is less than
 * 20 + 15, so the usual coin-system argument does not apply to this set — but
 * it ties or wins on plate count for every loading these denominations can
 * make, and it matches how a lifter actually loads a bar: biggest plate on
 * first. For 100kg it gives 25 + 15 rather than 20 + 20; both are two plates.
 *
 * A target the plates cannot reach exactly returns the closest loading BELOW it
 * with `shortBy` set, rather than rounding up — putting more weight on the bar
 * than a lifter asked for is the wrong direction to be wrong in.
 */
export function loadBar(target: number, set: PlateSet = DEFAULT_PLATES.kg): Loading {
  if (target <= set.bar) {
    return { perSide: [], achieved: set.bar, shortBy: round(target - set.bar), barOnly: true };
  }

  let remaining = (target - set.bar) / 2;
  const perSide: number[] = [];

  for (const plate of set.plates) {
    while (remaining >= plate - 1e-9) {
      perSide.push(plate);
      remaining = round(remaining - plate);
    }
  }

  const achieved = round(set.bar + perSide.reduce((sum, p) => sum + p, 0) * 2);
  return {
    perSide,
    achieved,
    shortBy: round(target - achieved),
    barOnly: perSide.length === 0,
  };
}

/** `2 × 20, 1 × 5` — how a lifter reads a side of the bar. */
export function describeSide(perSide: readonly number[]): string {
  if (perSide.length === 0) return 'Bar only';
  const counts = new Map<number, number>();
  for (const plate of perSide) counts.set(plate, (counts.get(plate) ?? 0) + 1);
  return [...counts.entries()].map(([plate, count]) => `${count} × ${plate}`).join(', ');
}

export interface WarmupSet {
  readonly weight: number;
  readonly reps: number;
  readonly percent: number;
  readonly loading: Loading;
}

/**
 * Warm-up sets up to a working weight.
 *
 * The scheme is the common one — bar, 40%, 60%, 80% — with reps falling as the
 * weight climbs, because the point is to rehearse the movement without
 * accumulating fatigue.
 *
 * Each step is snapped to what the plates can actually make, and steps that
 * collapse onto the same loading are dropped: three warm-up sets at the same
 * weight is noise, and at light working weights the percentages genuinely do
 * collide.
 */
export function warmupSets(
  working: number,
  set: PlateSet = DEFAULT_PLATES.kg,
): WarmupSet[] {
  if (working <= set.bar) return [];

  const scheme: { percent: number; reps: number }[] = [
    { percent: 0, reps: 8 },     // the empty bar
    { percent: 0.4, reps: 5 },
    { percent: 0.6, reps: 3 },
    { percent: 0.8, reps: 2 },
  ];

  const out: WarmupSet[] = [];
  const seen = new Set<number>();

  for (const step of scheme) {
    const target = step.percent === 0 ? set.bar : working * step.percent;
    const loading = loadBar(target, set);
    if (loading.achieved >= working) continue;
    if (seen.has(loading.achieved)) continue;
    seen.add(loading.achieved);
    out.push({ weight: loading.achieved, reps: step.reps, percent: step.percent, loading });
  }

  return out;
}
