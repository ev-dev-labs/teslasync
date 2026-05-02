import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { kmToMiles } from '@/lib/unitConversion';

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
  const { convertDistance, distanceUnit } = useSettings();

  let sourceMiles: number | null = null;
  let title: string | undefined;
  if (miles != null && Number.isFinite(miles)) {
    sourceMiles = miles;
    title = `${miles.toFixed(2)} mi`;
  } else if (km != null && Number.isFinite(km)) {
    sourceMiles = kmToMiles(km);
    title = `${km.toFixed(2)} km`;
  }

  if (sourceMiles == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(convertDistance(sourceMiles), precision);
  return (
    <span className={className} title={title}>
      {display} {distanceUnit}
    </span>
  );
}
