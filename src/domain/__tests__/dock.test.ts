import {
  applyChip, focusField, resolveLogValues, step, weightIsOptional, type DockState,
} from '../dock';

const state = (over: Partial<DockState> = {}): DockState => ({
  weight: 62.5, reps: 8, focus: 'weight', ...over,
});

describe('input dock', () => {
  it('adds a chip to the focused field only', () => {
    const next = applyChip(state(), 2.5);
    expect(next.weight).toBe(65);
    expect(next.reps).toBe(8);
  });

  it('adds to reps when reps has focus', () => {
    const next = applyChip(state({ focus: 'reps' }), 1);
    expect(next.reps).toBe(9);
    expect(next.weight).toBe(62.5);
  });

  it('subtracts on long-press', () => {
    expect(applyChip(state(), 2.5, 'subtract').weight).toBe(60);
  });

  // 62.5 + 2.5 must read as 65 in a column of tabular numerals.
  it('does not leak floating-point noise into the field', () => {
    expect(applyChip(state({ weight: 62.5 }), 2.5).weight).toBe(65);
    expect(applyChip(state({ weight: 0.1 }), 0.2).weight).toBe(0.3);
  });

  it('clamps at zero rather than going negative', () => {
    expect(applyChip(state({ weight: 1 }), 5, 'subtract').weight).toBe(0);
    expect(step(state({ reps: 0, focus: 'reps' }), 'reps', -1, 'kg').reps).toBe(0);
  });

  it('treats an empty field as zero when a chip is tapped', () => {
    expect(applyChip(state({ weight: null }), 20).weight).toBe(20);
  });

  it('steps weight by unit and reps by one', () => {
    expect(step(state(), 'weight', 1, 'kg').weight).toBe(65);
    expect(step(state(), 'weight', 1, 'lb').weight).toBe(67.5);
    expect(step(state(), 'reps', 1, 'kg').reps).toBe(9);
  });

  it('keeps reps whole', () => {
    expect(applyChip(state({ reps: 8, focus: 'reps' }), 2.5).reps).toBe(11);
  });

  it('moves focus without touching values', () => {
    const next = focusField(state(), 'reps');
    expect(next).toEqual({ weight: 62.5, reps: 8, focus: 'reps' });
  });
});

describe('the two-tap path', () => {
  const ok = (r: ReturnType<typeof resolveLogValues>) =>
    r.kind === 'ok' ? r.values : r.kind;

  it('logs what is shown', () => {
    expect(ok(resolveLogValues({ weight: 65, reps: 8 }, null))).toEqual({ weight: 65, reps: 8 });
  });

  it('copies the previous set when the row is empty', () => {
    expect(ok(resolveLogValues({ weight: null, reps: null }, { weightKg: 62, reps: 7 })))
      .toEqual({ weight: 62, reps: 7 });
  });

  it('copies only the field that is missing', () => {
    expect(ok(resolveLogValues({ weight: null, reps: 10 }, { weightKg: 62, reps: 7 })))
      .toEqual({ weight: 62, reps: 10 });
  });

  it('asks for reps when there is nothing to log and nothing to copy', () => {
    expect(resolveLogValues({ weight: null, reps: null }, null).kind).toBe('needs-reps');
    expect(resolveLogValues({ weight: 60, reps: null }, null).kind).toBe('needs-reps');
  });
});

describe('bodyweight is an answer, not an omission', () => {
  const ok = (r: ReturnType<typeof resolveLogValues>) =>
    r.kind === 'ok' ? r.values : r.kind;

  it('knows which exercises need a weight', () => {
    expect(weightIsOptional('body only')).toBe(true);
    expect(weightIsOptional('bands')).toBe(true);
    expect(weightIsOptional('barbell')).toBe(false);
    expect(weightIsOptional('machine')).toBe(false);
  });

  // A custom exercise has no equipment recorded; blocking on data we never
  // collected would be the wrong way round.
  it('lets an unknown exercise log without a weight', () => {
    expect(weightIsOptional(null)).toBe(true);
    expect(weightIsOptional(undefined)).toBe(true);
  });

  it('logs a pull-up with reps alone', () => {
    expect(ok(resolveLogValues({ weight: null, reps: 12 }, null, true)))
      .toEqual({ weight: null, reps: 12 });
  });

  // The case that prompted this: meaning 60kg, entering only reps.
  it('refuses a barbell set with no weight rather than calling it bodyweight', () => {
    expect(resolveLogValues({ weight: null, reps: 5 }, null, false).kind).toBe('needs-weight');
  });

  it('accepts it once bodyweight is declared deliberately', () => {
    expect(ok(resolveLogValues({ weight: null, reps: 5, bodyweight: true }, null, false)))
      .toEqual({ weight: null, reps: 5 });
  });

  it('still copies a weight from the previous set rather than asking', () => {
    expect(ok(resolveLogValues({ weight: null, reps: 5 }, { weightKg: 60, reps: 5 }, false)))
      .toEqual({ weight: 60, reps: 5 });
  });

  it('retracts the bodyweight claim as soon as a weight is entered', () => {
    const declared: DockState = { weight: null, reps: 5, focus: 'weight', bodyweight: true };
    expect(applyChip(declared, 20).bodyweight).toBe(false);
    expect(step(declared, 'weight', 1, 'kg').bodyweight).toBe(false);
  });
});
