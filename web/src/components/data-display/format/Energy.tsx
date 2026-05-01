import { fmtNumber } from '@/lib/numberFormat';

interface EnergyProps {
  /** Canonical input in kWh. */
  kwh?: number | null;
  /** Alternative input in Wh; converted to kWh before display. */
  wh?: number | null;
  precision?: number;
  className?: string;
  /** Force a display unit. Defaults to auto: Wh when |kWh| < 1, else kWh. */
  unit?: 'kWh' | 'Wh';
}

/**
 * Energy renderer that auto-picks Wh vs kWh for readability and exposes
 * the canonical kWh value via `title`.
 */
export function Energy({ kwh, wh, precision, className, unit }: EnergyProps) {
  let sourceKwh: number | null = null;
  if (kwh != null && Number.isFinite(kwh)) {
    sourceKwh = kwh;
  } else if (wh != null && Number.isFinite(wh)) {
    sourceKwh = wh / 1000;
  }

  if (sourceKwh == null) {
    return <span className={className}>—</span>;
  }

  const useWh = unit === 'Wh' || (unit !== 'kWh' && Math.abs(sourceKwh) < 1);
  const value = useWh ? sourceKwh * 1000 : sourceKwh;
  const display = fmtNumber(value, precision);
  return (
    <span className={className} title={`${sourceKwh.toFixed(3)} kWh`}>
      {display} {useWh ? 'Wh' : 'kWh'}
    </span>
  );
}
