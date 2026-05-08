import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertSpeedFromSI } from '@/lib/unitConversion';

interface SpeedProps {
  /** Canonical input in mph. */
  mph?: number | null;
  /** Alternative input in km/h; converted to mph before display. */
  kmh?: number | null;
  precision?: number;
  className?: string;
}

/**
 * Speed renderer that respects the user's metric/imperial preference.
 * Hover title shows the raw caller-supplied value with its source unit.
 */
export function Speed({ mph, kmh, precision, className }: SpeedProps) {
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);

  let sourceMph: number | null = null;
  let title: string | undefined;
  if (mph != null && Number.isFinite(mph)) {
    sourceMph = mph * 0.44704;
    title = `${mph.toFixed(1)} mph`;
  } else if (kmh != null && Number.isFinite(kmh)) {
    sourceMph = (kmh * 1000) / 3600;
    title = `${kmh.toFixed(1)} km/h`;
  }

  if (sourceMph == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(toSpeedDisplay(sourceMph), precision);
  return (
    <span className={className} title={title}>
      {display} {speedUnit}
    </span>
  );
}
