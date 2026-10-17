/**
 * Shared 8-wind compass label for reported headings (Map overview,
 * Navigation route). Presentation only: the degrees value is unchanged.
 */
export function headingToCardinal(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  /* Normalise into [0, 8) so the compass wraps correctly for any heading,
     including negative degrees (e.g. -45° == 315° == NW) — a bare `% 8`
     yields a negative index and an undefined direction. */
  const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
  return dirs[idx] ?? '—';
}
