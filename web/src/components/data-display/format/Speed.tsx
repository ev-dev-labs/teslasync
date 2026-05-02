import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { kmToMiles } from '@/lib/unitConversion';

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
  const { convertSpeed, speedUnit } = useSettings();

  let sourceMph: number | null = null;
  let title: string | undefined;
  if (mph != null && Number.isFinite(mph)) {
    sourceMph = mph;
    title = `${mph.toFixed(1)} mph`;
  } else if (kmh != null && Number.isFinite(kmh)) {
    sourceMph = kmToMiles(kmh);
    title = `${kmh.toFixed(1)} km/h`;
  }

  if (sourceMph == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(convertSpeed(sourceMph), precision);
  return (
    <span className={className} title={title}>
      {display} {speedUnit}
    </span>
  );
}
