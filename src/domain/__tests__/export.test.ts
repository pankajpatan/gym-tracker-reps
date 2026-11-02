import { parseStrong } from '../import/strong';
import { exportFilename, formatDate, formatDuration, quote, toCsv, type ExportSet } from '../export';

const row = (over: Partial<ExportSet> = {}): ExportSet => ({
  started_at: Math.floor(new Date(2026, 8, 15, 11, 22, 57).getTime() / 1000),
  session_name: 'Push', duration_s: 6180, exercise_name: 'Bench Press (Barbell)',
  position: 1, weight_kg: 60, reps: 5, distance_m: null, duration_set_s: null,
  note: null, session_note: null, rpe: null, ...over,
});

describe('the exported file', () => {
  it('leads with Strong\'s header, so other apps can read it', () => {
    expect(toCsv([]).split('\n')[0]).toBe(
      'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
    );
  });

  it('writes dates in local time, as Strong does', () => {
    expect(formatDate(Math.floor(new Date(2026, 8, 15, 11, 22, 57).getTime() / 1000)))
      .toBe('2026-09-15 11:22:57');
  });

  it('writes durations in Strong\'s forms', () => {
    expect(formatDuration(6180)).toBe('1h 43m');
    expect(formatDuration(2280)).toBe('38m');
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(0)).toBe('');
  });

  it('quotes only what needs quoting', () => {
    expect(quote('Bench')).toBe('Bench');
    expect(quote('Row, Barbell')).toBe('"Row, Barbell"');
    expect(quote('He said "go"')).toBe('"He said ""go"""');
    expect(quote('line\nbreak')).toBe('"line\nbreak"');
  });

  it('names the file by date so two exports never collide', () => {
    expect(exportFilename(new Date(2026, 8, 5))).toBe('gym-tracker-2026-09-05.csv');
  });
});

/**
 * The property that matters most: our export is a real Strong CSV, so it goes
 * back into this app — and into Hevy, whose importer accepts that format. A
 * lifter can leave with their data, which is the same promise the import makes
 * on the way in.
 */
describe('a round trip through our own importer', () => {
  it('reads its own export back', () => {
    const csv = toCsv([
      row(),
      row({ position: 2, weight_kg: 62.5, reps: 8 }),
      row({ exercise_name: 'Squat (Barbell)', position: 1, weight_kg: 100, reps: 5 }),
    ]);

    const parsed = parseStrong(csv);
    expect(parsed.source).toBe('strong');
    expect(parsed.skipped).toHaveLength(0);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0]?.sets).toHaveLength(3);
    expect(parsed.sessions[0]?.sets[1]).toMatchObject({ weightKg: 62.5, reps: 8 });
  });

  it('keeps a name containing a comma intact through the round trip', () => {
    const parsed = parseStrong(toCsv([row({ exercise_name: 'Row, Barbell' })]));
    expect(parsed.sessions[0]?.sets[0]?.exerciseName).toBe('Row, Barbell');
  });

  it('keeps the session title and timestamp', () => {
    const parsed = parseStrong(toCsv([row()]));
    expect(parsed.sessions[0]?.title).toBe('Push');
    expect(parsed.sessions[0]?.startedAt).toBe(row().started_at);
  });

  // Strong writes 0 for an absent weight and our parser reads 0 as a weight of
  // zero, so a bodyweight set survives as bodyweight rather than as 0 kg only
  // because reps carry it. Documented here so the asymmetry is not a surprise.
  it('round-trips a bodyweight set as reps with no added weight', () => {
    const parsed = parseStrong(toCsv([row({ exercise_name: 'Pull Up', weight_kg: null, reps: 12 })]));
    const set = parsed.sessions[0]?.sets[0];
    expect(set?.reps).toBe(12);
    expect(set?.weightKg).toBe(0);
  });

  it('survives an empty export', () => {
    expect(parseStrong(toCsv([])).sessions).toHaveLength(0);
  });
});
