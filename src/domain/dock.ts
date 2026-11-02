/**
 * Input dock arithmetic (UI.md §3.2).
 *
 * The dock replaces the system keyboard, so every value change goes through
 * these functions: chips add, long-press subtracts, steppers move by unit. They
 * are pure and separately tested because this is the interaction the whole app
 * is judged on and it cannot be exercised in a simulator on this machine.
 */

import { weightStep, type Unit } from './units';

export type DockField = 'weight' | 'reps';

export interface DockState {
  readonly weight: number | null;
  readonly reps: number | null;
  readonly focus: DockField;
  /** Set by tapping BW: "this set genuinely has no weight", not "I forgot". */
  readonly bodyweight?: boolean;
}

/**
 * Values never go negative: subtracting past zero clamps to zero rather than
 * to null, because an empty field and a zero mean different things — empty
 * copies the previous set on log, zero is a deliberate bodyweight entry.
 */
function clamp(value: number): number {
  return value < 0 ? 0 : value;
}

/** Floating-point tidy-up: 62.5 + 2.5 must be 65, not 64.99999999999999. */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A chip tap adds its value to the focused field; long-press subtracts. */
export function applyChip(
  state: DockState,
  amount: number,
  mode: 'add' | 'subtract' = 'add',
): DockState {
  const delta = mode === 'add' ? amount : -amount;
  const current = state.focus === 'weight' ? state.weight : state.reps;
  const next = tidy(clamp((current ?? 0) + delta));

  return state.focus === 'weight'
    ? { ...state, weight: next, bodyweight: false }
    : { ...state, reps: Math.round(next) };
}

/** Stepper: weight moves by unit (2.5kg / 5lb), reps by 1. */
export function step(
  state: DockState,
  field: DockField,
  direction: 1 | -1,
  unit: Unit,
): DockState {
  if (field === 'weight') {
    const amount = weightStep(unit) * direction;
    // Touching the weight retracts a bodyweight claim — they contradict.
    return { ...state, weight: tidy(clamp((state.weight ?? 0) + amount)), bodyweight: false };
  }
  return { ...state, reps: Math.round(clamp((state.reps ?? 0) + direction)) };
}

export function focusField(state: DockState, field: DockField): DockState {
  return { ...state, focus: field };
}

export interface PreviousSet {
  readonly weightKg: number | null;
  readonly reps: number | null;
}

/**
 * Whether an empty weight is an answer or an omission — decided by the
 * exercise, not by asking.
 *
 * A pull-up with no weight is a complete set; a barbell bench press with no
 * weight is a lifter who tapped Log before typing. The library already knows
 * which is which (`equipment`), so 81 of the 657 shipped exercises never need
 * to be asked, and the rest are protected from a silent wrong entry.
 *
 * Unknown equipment — a custom exercise the user typed — is treated as
 * bodyweight-allowed. Blocking someone on data we never had is the wrong way
 * round, and a custom exercise is most often a bodyweight or machine movement
 * the library was missing.
 */
const NO_WEIGHT_NEEDED = new Set(['body only', 'none', 'bands', '']);

export function weightIsOptional(equipment: string | null | undefined): boolean {
  if (equipment === null || equipment === undefined) return true;
  return NO_WEIGHT_NEEDED.has(equipment.toLowerCase().trim());
}

export type LogValues = { readonly weight: number | null; readonly reps: number | null };

export type Resolution =
  | { readonly kind: 'ok'; readonly values: LogValues }
  | { readonly kind: 'needs-reps' }
  | { readonly kind: 'needs-weight' };

/**
 * What tapping ○ actually logs (UI.md §3): whatever is shown, and if a field is
 * empty, the previous column. This is the two-tap path — pick the row, log it —
 * and it is why the previous column has to be real data, not a placeholder.
 *
 * It refuses in two distinguishable ways so the screen can say which:
 * - `needs-reps`: nothing to log and nothing to copy.
 * - `needs-weight`: a weighted exercise with no weight, no weight to copy, and
 *   no deliberate BW tap. Logging that silently as bodyweight would put a
 *   wrong, invisible number into every chart and PR that follows.
 */
export function resolveLogValues(
  state: Pick<DockState, 'weight' | 'reps' | 'bodyweight'>,
  previous: PreviousSet | null,
  weightOptional = true,
): Resolution {
  const weight = state.weight ?? previous?.weightKg ?? null;
  const reps = state.reps ?? previous?.reps ?? null;

  if (reps === null) return { kind: 'needs-reps' };
  if (weight === null && !weightOptional && state.bodyweight !== true) {
    return { kind: 'needs-weight' };
  }
  return { kind: 'ok', values: { weight, reps } };
}
