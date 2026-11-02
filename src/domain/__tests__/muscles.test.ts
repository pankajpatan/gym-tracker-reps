import { MUSCLE_LABEL, MUSCLE_SIDE, toSlug, type MuscleSlug } from '../muscles';

describe('muscle mapping', () => {
  it('translates the dataset vocabulary to artwork slugs', () => {
    expect(toSlug('shoulders')).toBe('deltoids');
    expect(toSlug('abdominals')).toBe('abs');
    expect(toSlug('glutes')).toBe('gluteal');
  });

  it('collapses lats and middle back onto the one back region the art has', () => {
    expect(toSlug('lats')).toBe('upper-back');
    expect(toSlug('middle back')).toBe('upper-back');
  });

  it('sends abductors to glutes rather than dropping them', () => {
    expect(toSlug('abductors')).toBe('gluteal');
  });

  it('is case and whitespace tolerant', () => {
    expect(toSlug('  Lower Back ')).toBe('lower-back');
  });

  it('returns null for a muscle it has never seen', () => {
    expect(toSlug('gills')).toBeNull();
  });

  it('gives every slug a label and a side', () => {
    for (const slug of Object.keys(MUSCLE_LABEL) as MuscleSlug[]) {
      expect(MUSCLE_LABEL[slug]).toBeTruthy();
      expect(['front', 'back']).toContain(MUSCLE_SIDE[slug]);
    }
  });
});
