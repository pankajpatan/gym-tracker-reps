/**
 * Units live at the edge (SPEC.md): kg is the only thing ever stored.
 *
 * The conversion factor is exact by definition (1 lb = 0.45359237 kg), so the
 * only judgement here is rounding — and it is a display decision, never applied
 * to a stored value.
 */

export type Unit = 'kg' | 'lb';

export const KG_PER_LB = 0.45359237;

export function toKg(value: number, unit: Unit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

export function fromKg(kg: number, unit: Unit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

/**
 * What the lifter sees in the weight field.
 *
 * Plates come in halves, so kg shows at most one decimal and lb at most one;
 * a trailing `.0` is dropped because a column of `65.0` reads as noise next to
 * `62.5`. Never used to round anything on its way into the database.
 */
export function formatWeight(kg: number, unit: Unit): string {
  const value = fromKg(kg, unit);
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The increment a stepper moves by, in the displayed unit (UI.md §3.2). */
export function weightStep(unit: Unit): number {
  return unit === 'kg' ? 2.5 : 5;
}

/** Chip values by unit (UI.md §3.2). */
export function weightChips(unit: Unit): readonly number[] {
  return unit === 'kg' ? [1, 2.5, 5, 10, 20, 25] : [2.5, 5, 10, 25, 45, 100];
}
