export type WinnerSemantic = 'higher' | 'lower' | 'neutral';

export interface ComparisonRow {
  metric: string;
  valueA: string;
  valueB: string;
  rawA: number | null;
  rawB: number | null;
  winner: WinnerSemantic;
}

/** Unknown measurements never win against an observed zero. No unit conversion. */
export function getWinner(
  a: number | null,
  b: number | null,
  semantic: WinnerSemantic,
): 'a' | 'b' | 'tie' {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return 'tie';
  if (semantic === 'neutral' || a === b) return 'tie';
  if (semantic === 'higher') return a > b ? 'a' : 'b';
  return a < b ? 'a' : 'b';
}

/** Keep the caller's specialist precision, currency and SI display contract. */
export function formatKnown(
  value: number | null | undefined,
  format: (value: number) => string,
): string {
  return value != null && Number.isFinite(value) ? format(value) : '—';
}
