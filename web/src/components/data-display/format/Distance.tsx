import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface DistanceProps {
  /** Canonical input in miles (matches the codebase internal unit). */
  miles?: number | null;
  /** Alternative input in kilometres; converted to miles before display. */
  km?: number | null;
  /** Optional decimal precision; defaults to user setting via fmtNumber. */
  precision?: number;
  className?: string;
}

/**
 * Distance renderer that respects the user's metric/imperial preference.
 * Always exposes the raw caller-supplied value via the `title` attribute.
 */
export function Distance({ miles, km, precision, className }: DistanceProps) {
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  let sourceMiles: number | null = null;
  let title: string | undefined;
  if (miles != null && Number.isFinite(miles)) {
    sourceMiles = miles * 1609.344;
    title = `${miles.toFixed(2)} mi`;
  } else if (km != null && Number.isFinite(km)) {
    sourceMiles = km * 1000;
    title = `${km.toFixed(2)} km`;
  }

  if (sourceMiles == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(toDistanceDisplay(sourceMiles), precision);
  return (
    <span className={className} title={title}>
      {display} {distanceUnit}
    </span>
  );
}
