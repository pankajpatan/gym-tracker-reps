import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCEPT, matchExercise, stripGripQualifier, type LibraryEntry } from '../match';

const seed = JSON.parse(
  readFileSync(join(__dirname, '../../../assets/exercise-seed.json'), 'utf8'),
) as { name: string; equipment: string | null }[];

const library: LibraryEntry[] = seed.map((entry, index) => ({
  id: index + 1, name: entry.name, equipment: entry.equipment,
}));

describe('matchExercise', () => {
  it('bridges the naming conventions the 0.9 rule could not', () => {
    // The library says `Barbell Bench Press - Medium Grip`; exports say this.
    expect(matchExercise('Bench Press (Barbell)', library)?.entry.name).toMatch(/Bench Press/);
  });

  it('prefers the plain entry when the export said nothing more', () => {
    const match = matchExercise('Clean (Barbell)', library);
    expect(match?.entry.name).toBe('Clean');
  });

  it('reads Alpha\'s separator the same as brackets', () => {
    expect(matchExercise('Bench Press · Dumbbells', library)?.entry.name).toMatch(/Bench Press/i);
  });

  it('strips a trailing grip qualifier', () => {
    expect(stripGripQualifier('Rows with Wide Neutral Grip')).toBe('Rows');
    expect(stripGripQualifier('Pull-Ups with Close Neutral Grip')).toBe('Pull-Ups');
    // Not a trailing qualifier: leave it alone.
    expect(stripGripQualifier('Wide-Grip Lat Pulldown')).toBe('Wide-Grip Lat Pulldown');
  });

  it('refuses rather than guessing wildly', () => {
    expect(matchExercise('Swimming', library)).toBeNull();
    expect(matchExercise('Stair Machine (Floors)', library)).toBeNull();
  });

  it('flags a plausible-but-uncertain match instead of matching silently', () => {
    const match = matchExercise('Bench Press (Barbell)', library);
    expect(match?.score).toBeGreaterThanOrEqual(ACCEPT);
    expect(typeof match?.confident).toBe('boolean');
  });
});
