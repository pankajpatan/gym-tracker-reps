/**
 * `name_norm` — the join key for import matching (SPEC.md).
 *
 * Lowercase, punctuation stripped, whitespace collapsed. Deliberately lossy:
 * `Bench Press (Barbell)` and `bench press - barbell` must collide, because an
 * export and the library will spell the same movement differently. The richer
 * scored matching that MATCHING.md specifies is built on top of this, not
 * inside it — this function stays cheap and predictable because a UNIQUE index
 * depends on it.
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: Alpha exports carry them
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
