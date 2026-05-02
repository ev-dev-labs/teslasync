import { fmtNumber } from '@/lib/numberFormat';

interface PowerProps {
  /** Canonical input in kW. */
  kw?: number | null;
  /** Alternative input in W; converted to kW before display. */
  w?: number | null;
  precision?: number;
  className?: string;
  /** Force a display unit. Defaults to auto: W when |kW| < 1, else kW. */
  unit?: 'kW' | 'W';
}

/**
 * Power renderer that auto-picks W vs kW for readability and exposes the
 * canonical kW value via `title`.
 */
export function Power({ kw, w, precision, className, unit }: PowerProps) {
  let sourceKw: number | null = null;
  if (kw != null && Number.isFinite(kw)) {
    sourceKw = kw;
  } else if (w != null && Number.isFinite(w)) {
    sourceKw = w / 1000;
  }

  if (sourceKw == null) {
    return <span className={className}>—</span>;
  }

  const useW = unit === 'W' || (unit !== 'kW' && Math.abs(sourceKw) < 1);
  const value = useW ? sourceKw * 1000 : sourceKw;
  const display = fmtNumber(value, precision);
  return (
    <span className={className} title={`${sourceKw.toFixed(3)} kW`}>
      {display} {useW ? 'W' : 'kW'}
    </span>
  );
}
