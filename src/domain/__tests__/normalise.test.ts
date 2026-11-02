import { normaliseName } from '../normalise';

describe('normaliseName', () => {
  it('collides the spellings an export and the library disagree on', () => {
    expect(normaliseName('Bench Press (Barbell)')).toBe(normaliseName('bench press - barbell'));
    expect(normaliseName('Pull-Up')).toBe(normaliseName('Pull Up'));
    expect(normaliseName('  Squat   (Barbell) ')).toBe('squat barbell');
  });

  it('strips accents, which Alpha exports carry', () => {
    expect(normaliseName('Rückenstrecker')).toBe('ruckenstrecker');
  });

  it('keeps digits, which name real exercises', () => {
    expect(normaliseName('3/4 Sit-Up')).toBe('3 4 sit up');
  });

  it('does not collapse genuinely different movements', () => {
    expect(normaliseName('Front Squat')).not.toBe(normaliseName('Back Squat'));
  });
});
