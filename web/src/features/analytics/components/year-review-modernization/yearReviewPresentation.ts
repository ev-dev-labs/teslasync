/** Existing month policy, copied from the acquisition source without changing
 * calendar/query semantics. This helper only produces a display label. */
export function monthShortLabel(month: number | null | undefined, locale: string | undefined): string {
  const n = typeof month === 'number' && Number.isFinite(month) ? month : 1;
  const clamped = Math.min(12, Math.max(1, Math.round(n)));
  return new Date(2000, clamped - 1, 1).toLocaleString(locale, { month: 'short' });
}

/** Existing peak-hour wrap/truncate policy; deliberately not a timezone conversion. */
export function to12Hour(rawHour: number | null | undefined): { hour12: number; isPM: boolean } {
  const truncated = typeof rawHour === 'number' && Number.isFinite(rawHour) ? Math.trunc(rawHour) : 0;
  const hour = ((truncated % 24) + 24) % 24;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return { hour12, isPM: hour >= 12 };
}

/** Preserve the specialist compact record duration, including 59.6 → 1h 0m. */
export function recordDuration(totalMinutes: number): string {
  const safeMinutes = Number.isFinite(totalMinutes) && totalMinutes > 0 ? totalMinutes : 0;
  const rounded = Math.round(safeMinutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}
