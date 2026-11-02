/**
 * Edge cases for the parsers.
 *
 * Real export files are produced by other people's code and handed to us
 * through a share sheet. Everything here is a shape one could plausibly arrive
 * in, and the rule throughout is the same: **never lose a row silently**. A row
 * we cannot read goes to `skipped` with a reason and a line number, because
 * "some of my history is missing" is unanswerable if nothing was recorded.
 */

import { parseRows, sniffDelimiter, stripBom } from '../csv';
import { detectDayFirst, parseDuration, parseTimestamp } from '../dates';
import { detectSource, parseImport } from '../detect';
import { parseHevy } from '../hevy';
import { parseStrong } from '../strong';
import { parseAlphaPlans, parseAlphaWorkouts } from '../alpha';
import { parseNumber, toKilograms } from '../types';

const STRONG_HEADER = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE';
const HEVY_HEADER = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"';

describe('files that are barely files', () => {
  it('survives an empty file', () => {
    expect(detectSource('')).toBe('unknown');
    expect(parseImport('').sessions).toHaveLength(0);
  });

  it('survives whitespace only', () => {
    expect(parseImport('   \n\n  \n').sessions).toHaveLength(0);
  });

  it('survives a header with no rows', () => {
    const parsed = parseStrong(STRONG_HEADER);
    expect(parsed.sessions).toHaveLength(0);
    expect(parsed.skipped).toHaveLength(0);
  });

  it('survives a file of only blank lines after the header', () => {
    expect(parseStrong(`${STRONG_HEADER}\n\n\n`).sessions).toHaveLength(0);
  });

  it('does not mistake an unrelated CSV for an export', () => {
    expect(detectSource('name,email\nbob,b@example.com')).toBe('unknown');
    expect(detectSource('id;value\n1;2')).toBe('unknown');
  });
});

describe('encodings and line endings', () => {
  it('strips a UTF-8 BOM', () => {
    expect(stripBom('﻿hello')).toBe('hello');
    expect(detectSource(`﻿${STRONG_HEADER}`)).toBe('strong');
  });

  it('reads CRLF as happily as LF', () => {
    const crlf = `${STRONG_HEADER}\r\n2020-09-15 11:22:57,"A",1h,"Bench",1,60,5,0,0,"","",\r\n`;
    expect(parseStrong(crlf).sessions).toHaveLength(1);
  });

  it('keeps accents and emoji in exercise names', () => {
    const text = `${STRONG_HEADER}\n2020-09-15 11:22:57,"A",1h,"Rückenstrecker 💪",1,60,5,0,0,"","",`;
    expect(parseStrong(text).sessions[0]?.sets[0]?.exerciseName).toBe('Rückenstrecker 💪');
  });

  it('handles a quoted field containing a newline', () => {
    const rows = parseRows('a,b\n"line one\nline two",5');
    expect(rows[1]?.[0]).toBe('line one\nline two');
    expect(rows[1]?.[1]).toBe('5');
  });

  it('handles doubled quotes inside a field', () => {
    expect(parseRows('a\n"He said ""go"""')[1]?.[0]).toBe('He said "go"');
  });
});

describe('rows that do not fit their header', () => {
  it('reads a short row without inventing values', () => {
    const text = `${STRONG_HEADER}\n2020-09-15 11:22:57,"A",1h,"Bench",1,60,5`;
    const set = parseStrong(text).sessions[0]?.sets[0];
    expect(set?.reps).toBe(5);
    expect(set?.rpe).toBeNull();
  });

  it('ignores extra columns rather than shifting', () => {
    const text = `${STRONG_HEADER},Extra\n2020-09-15 11:22:57,"A",1h,"Bench",1,60,5,0,0,"","",,junk`;
    expect(parseStrong(text).sessions[0]?.sets[0]?.reps).toBe(5);
  });

  it('skips a row with no exercise name and says why', () => {
    const text = `${STRONG_HEADER}\n2020-09-15 11:22:57,"A",1h,"",1,60,5,0,0,"","",`;
    const parsed = parseStrong(text);
    expect(parsed.sessions).toHaveLength(0);
    expect(parsed.skipped[0]).toMatchObject({ line: 2, reason: 'no exercise name' });
  });

  it('skips a row with an unreadable date and says which line', () => {
    const text = `${STRONG_HEADER}\nnot-a-date,"A",1h,"Bench",1,60,5,0,0,"","",`;
    expect(parseStrong(text).skipped[0]).toMatchObject({ line: 2, reason: 'unreadable date' });
  });

  it('skips a set with no measurement at all', () => {
    const text = `${STRONG_HEADER}\n2020-09-15 11:22:57,"A",1h,"Bench",1,,,0,0,"","",`;
    const parsed = parseStrong(text);
    expect(parsed.sessions).toHaveLength(0);
    expect(parsed.skipped[0]?.reason).toContain('no reps');
  });
});

describe('numbers as they really arrive', () => {
  it('reads a decimal comma and a thousands comma differently', () => {
    expect(parseNumber('62,5')).toBe(62.5);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('1,234.5')).toBe(1234.5);
  });

  it('reads a negative, which a bad export can contain', () => {
    expect(parseNumber('-5')).toBe(-5);
  });

  it('is null for junk rather than NaN', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });

  it('keeps a very large number rather than overflowing', () => {
    expect(parseNumber('99999')).toBe(99999);
  });

  it('converts pounds exactly', () => {
    expect(toKilograms(225, 'lb')).toBeCloseTo(102.058, 3);
    expect(toKilograms(null, 'lb')).toBeNull();
    expect(toKilograms(100, 'kg')).toBe(100);
  });
});

describe('dates', () => {
  it('reads every form the fixtures contain', () => {
    expect(parseTimestamp('2020-09-15 11:22:57')).not.toBeNull();
    expect(parseTimestamp('30 Jun 2025, 19:56')).not.toBeNull();
    expect(parseTimestamp('2024-02-01T16:00:00Z')).not.toBeNull();
    expect(parseTimestamp('2025-01-04 9:31 h')).not.toBeNull();
  });

  it('returns null for junk instead of 1970', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('tomorrow')).toBeNull();
    expect(parseTimestamp('99-99-99')).toBeNull();
  });

  it('decides day-first across the file, never per row', () => {
    expect(detectDayFirst(['01/02/2026', '13/02/2026'])).toBe(true);
    expect(detectDayFirst(['02/13/2026', '01/02/2026'])).toBe(false);
    expect(detectDayFirst(['01/02/2026'])).toBe(true);   // ambiguous: majority form
  });

  it('reads a duration of zero as zero, not as missing', () => {
    expect(parseDuration('0m')).toBe(0);
    expect(parseDuration('junk')).toBeNull();
  });
});

describe('Hevy oddities', () => {
  it('treats set_index 0 as a real set', () => {
    const text = `${HEVY_HEADER}\n"A","30 Jun 2025, 19:56","30 Jun 2025, 20:58","","Bench",,"",0,"normal",60,5,,,`;
    expect(parseHevy(text).sessions[0]?.sets).toHaveLength(1);
  });

  it('groups two workouts that start at the same minute separately from later ones', () => {
    const text = [HEVY_HEADER,
      '"A","30 Jun 2025, 19:56","30 Jun 2025, 20:58","","Bench",,"",0,"normal",60,5,,,',
      '"A","30 Jun 2025, 19:56","30 Jun 2025, 20:58","","Squat",,"",0,"normal",80,5,,,',
      '"B","1 Jul 2025, 08:00","1 Jul 2025, 09:00","","Bench",,"",0,"normal",60,5,,,',
    ].join('\n');
    expect(parseHevy(text).sessions).toHaveLength(2);
  });

  it('reads an unknown set_type as normal rather than dropping the set', () => {
    const text = `${HEVY_HEADER}\n"A","30 Jun 2025, 19:56","","","Bench",,"",0,"cluster",60,5,,,`;
    expect(parseHevy(text).sessions[0]?.sets[0]?.type).toBe('normal');
  });

  it('keeps a distance-only cardio row', () => {
    const text = `${HEVY_HEADER}\n"A","30 Jun 2025, 19:56","","","Run",,"",0,"normal",,,5,,`;
    const set = parseHevy(text).sessions[0]?.sets[0];
    expect(set?.distanceM).toBe(5000);
    expect(set?.reps).toBeNull();
  });

  it('keeps a duration-only plank', () => {
    const text = `${HEVY_HEADER}\n"A","30 Jun 2025, 19:56","","","Plank",,"",0,"normal",,,,60,`;
    expect(parseHevy(text).sessions[0]?.sets[0]?.durationS).toBe(60);
  });

  it('tolerates a missing end_time', () => {
    const text = `${HEVY_HEADER}\n"A","30 Jun 2025, 19:56","","","Bench",,"",0,"normal",60,5,,,`;
    expect(parseHevy(text).sessions[0]?.endedAt).toBeNull();
  });
});

describe('Alpha oddities', () => {
  it('ignores a set block that never had an exercise', () => {
    const text = '"Plan · Day";"2025-01-07 12:29 h";"1:06 hr"\n#;KG;REPS\n1;60;15\n';
    const parsed = parseAlphaWorkouts(text);
    expect(parsed.sessions).toHaveLength(0);
    expect(parsed.skipped.length).toBeGreaterThan(0);
  });

  it('ignores an unknown metric column instead of misreading it', () => {
    const text = [
      '"Plan · Day";"2025-01-07 12:29 h";"1:06 hr"',
      '"1. Odd Lift · Machine"',
      '#;FOO;REPS',
      '1;9;15',
    ].join('\n');
    const set = parseAlphaWorkouts(text).sessions[0]?.sets[0];
    expect(set?.reps).toBe(15);
    expect(set?.weightKg).toBeNull();
  });

  it('reads a bodyweight-added value and a dash as different things', () => {
    const text = [
      '"Plan · Day";"2025-01-07 12:29 h";"1:06 hr"',
      '"1. Dips · Bodyweight"',
      '#;KG;REPS',
      '1;+5;10',
      '2;-;10',
    ].join('\n');
    const sets = parseAlphaWorkouts(text).sessions[0]?.sets ?? [];
    expect(sets[0]?.weightKg).toBe(5);
    expect(sets[1]?.weightKg).toBeNull();
  });

  it('reads mm:ss on a time metric', () => {
    const text = [
      '"Plan · Day";"2025-01-07 12:29 h";"1:06 hr"',
      '"1. Plank · Bodyweight"',
      '#;SECS',
      '1;1:10',
    ].join('\n');
    expect(parseAlphaWorkouts(text).sessions[0]?.sets[0]?.durationS).toBe(70);
  });

  it('drops a session that ended up with no sets', () => {
    const text = '"Plan · Day";"2025-01-07 12:29 h";"1:06 hr"\n"1. Bench · Barbell"\n';
    expect(parseAlphaWorkouts(text).sessions).toHaveLength(0);
  });

  it('returns no routines from a plans file with no days', () => {
    expect(parseAlphaPlans('"Upper/Lower · 8 weeks";2025-01-02\n')).toHaveLength(0);
  });
});

describe('delimiters', () => {
  it('reads a tab-separated file', () => {
    const text = `${STRONG_HEADER.replace(/,/g, '\t')}\n2020-09-15 11:22:57\tA\t1h\tBench\t1\t60\t5\t0\t0\t\t\t`;
    expect(sniffDelimiter(text)).toBe('\t');
    expect(parseStrong(text).sessions).toHaveLength(1);
  });

  it('does not let a quoted comma pick the delimiter', () => {
    expect(sniffDelimiter('"Row, Barbell";"2025-01-01";"1h"')).toBe(';');
  });
});
