import { fmtNumber } from '@/lib/numberFormat';

/**
 * Format a power reading (SI watts) as a human-readable string, auto-scaling
 * to kW past 1000 W. Used where a shared `<Power>` component can't be passed
 * (e.g. `StatCard`/`MetricCard` `value` props that accept `string | number`).
 */
export function fmtWatts(watts: number | null | undefined): string {
  if (watts == null) return '—';
  const abs = Math.abs(watts);
  if (abs >= 1000) return `${fmtNumber(watts / 1000, 1)} kW`;
  return `${fmtNumber(watts, 0)} W`;
}

/**
 * Format an energy reading (SI watt-hours) as a human-readable string,
 * auto-scaling to kWh past 1000 Wh.
 */
export function fmtWh(wh: number | null | undefined): string {
  if (wh == null) return '—';
  if (Math.abs(wh) >= 1000) return `${fmtNumber(wh / 1000, 1)} kWh`;
  return `${fmtNumber(wh, 0)} Wh`;
}
