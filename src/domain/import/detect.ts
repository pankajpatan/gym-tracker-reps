/**
 * Which app wrote this file (IMPORT.md).
 *
 * Detection is on content, never on filename — every one of these exports is
 * called something like `strong.csv` or `workouts.csv` by the time it reaches
 * us, and a renamed file must still import.
 */

import { normaliseHeader, parseRows, stripBom } from './csv';
import { isAlpha, parseAlphaPlans, parseAlphaWorkouts } from './alpha';
import { isHevy, parseHevy } from './hevy';
import { isStrong, parseStrong } from './strong';
import { EMPTY, type ImportSource, type ParsedFile } from './types';

export function detectSource(text: string): ImportSource {
  const firstRow = parseRows(stripBom(text).split(/\r?\n/).slice(0, 1).join('\n'))[0] ?? [];
  const header = normaliseHeader(firstRow);

  if (isStrong(header)) return 'strong';
  if (isHevy(header)) return 'hevy';
  // Alpha last: it has no header to match, so it is identified structurally and
  // must not shadow a file that does declare its columns.
  if (isAlpha(text)) return 'alpha';
  return 'unknown';
}

export interface ParseOptions {
  /** Strong exports carry no unit marker; the preview asks. */
  readonly strongUnit?: 'kg' | 'lb';
}

export function parseImport(text: string, options: ParseOptions = {}): ParsedFile {
  switch (detectSource(text)) {
    case 'strong':
      return parseStrong(text, options.strongUnit ?? 'kg');
    case 'hevy':
      return parseHevy(text);
    case 'alpha': {
      // One Alpha export may be a workout log or a plans file; both are valid
      // imports and the user should not have to know which they picked.
      const routines = parseAlphaPlans(text);
      if (routines.length > 0) {
        return { source: 'alpha', sessions: [], routines, skipped: [] };
      }
      return parseAlphaWorkouts(text);
    }
    default:
      return EMPTY;
  }
}
