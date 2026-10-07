import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface DistanceProps {
  /** Caller-supplied distance in miles. Converted to SI metres before display. */
  miles?: number | null;
  /** Alternative caller-supplied distance in kilometres. Converted to SI metres before display. */
  km?: number | null;
  /** Optional decimal precision; defaults to user setting via fmtNumber. */
  precision?: number;
  className?: string;
}

/**
 * Distance renderer that respects the user's metric/imperial preference.
 * The title shows the caller's source unit at the requested display precision.
 */
export function Distance({ miles, km, precision, className }: DistanceProps) {
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  let sourceMeters: number | null = null;
  let title: string | undefined;
  if (miles != null && Number.isFinite(miles)) {
    sourceMeters = miles * 1609.344;
    title = `${fmtNumber(miles, precision)} mi`;
  } else if (km != null && Number.isFinite(km)) {
    sourceMeters = km * 1000;
    title = `${fmtNumber(km, precision)} km`;
  }

  if (sourceMeters == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(toDistanceDisplay(sourceMeters), precision);
  return (
    <span className={className} title={title}>
      {display} {distanceUnit}
    </span>
  );
}
