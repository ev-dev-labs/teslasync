/**
 * Formats a duration given in *minutes* as a compact "Xh Ym" / "Ym" string.
 *
 * Rounds to whole minutes on the total (not per-field) so a value that rounds
 * up to a full hour carries correctly: 59.6 → "1h 0m" (never "60m") and
 * 119.7 → "2h 0m" (never "1h 60m"). Non-finite or negative inputs — which a
 * bad/in-progress drive can produce via `durationS / 60` — collapse to "0m"
 * instead of leaking "NaNm"/"Infinityh NaNm".
 */
export function formatDuration(min: number): string {
  const totalMinutes = Number.isFinite(min) && min > 0 ? Math.round(min) : 0;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Recharts <Legend wrapperStyle> for the drive-detail charts. Colour uses the
// shared --text-muted token (matching the sibling axis ticks) so the legend
// stays legible under every theme instead of pinning a dark-mode-only grey.
export const LEGEND_STYLE = { fontSize: 10, color: 'var(--text-muted)' } as const;
