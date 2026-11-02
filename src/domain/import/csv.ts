/**
 * A CSV reader that survives real export files.
 *
 * Not a general parser — a deliberately small one that handles what the
 * fixtures actually contain: quoted fields with embedded commas and newlines,
 * doubled quotes, a UTF-8 BOM, CRLF, and a delimiter that is not always a
 * comma (IMPORT.md: Hevy is documented as emitting TSV on some tiers, and
 * Alpha uses semicolons).
 */

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * Sniffs the delimiter from the first non-empty line, counting only characters
 * outside quotes — an exercise named `Row, Barbell` must not vote for comma.
 */
export function sniffDelimiter(text: string): string {
  const line = stripBom(text).split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char] = (counts[char] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',';
}

/** Rows of raw cells, preserving blank lines as empty rows so line numbers hold. */
export function parseRows(text: string, delimiter?: string): string[][] {
  const input = stripBom(text);
  const delim = delimiter ?? sniffDelimiter(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += char;
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === delim) { row.push(cell); cell = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** Header cells, normalised for comparison: lowercase, trimmed, quotes gone. */
export function normaliseHeader(cells: readonly string[]): string[] {
  return cells.map((cell) => cell.replace(/"/g, '').trim().toLowerCase());
}

export function indexOfHeaders(header: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((name, index) => { if (!map.has(name)) map.set(name, index); });
  return map;
}
