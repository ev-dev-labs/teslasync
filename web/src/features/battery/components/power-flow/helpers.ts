import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';

/**
 * Format a power reading (SI watts) as a human-readable string, auto-scaling
 * to kW past 1000 W. Used where a shared `<Power>` component can't be passed
 * (e.g. `StatCard`/`MetricCard` `value` props that accept `string | number`).
 *
 * Non-finite inputs (null, undefined, NaN, ±Infinity) render as the em-dash
 * placeholder rather than being coerced to 0 — a divide-by-zero or missing
 * signal must not masquerade as "0 W"/"0.0 kW" on the power-flow dashboard.
 */
export function fmtWatts(watts: number | null | undefined): string {
  if (!isFiniteNumber(watts)) return '—';
  const abs = Math.abs(watts);
  if (abs >= 1000) return `${fmtNumber(watts / 1000, 1)} kW`;
  return `${fmtNumber(watts, 0)} W`;
}

/**
 * Format an energy reading (SI watt-hours) as a human-readable string,
 * auto-scaling to kWh past 1000 Wh. Non-finite inputs render as the em-dash
 * placeholder (see `fmtWatts`).
 */
export function fmtWh(wh: number | null | undefined): string {
  if (!isFiniteNumber(wh)) return '—';
  if (Math.abs(wh) >= 1000) return `${fmtNumber(wh / 1000, 1)} kWh`;
  return `${fmtNumber(wh, 0)} Wh`;
}
