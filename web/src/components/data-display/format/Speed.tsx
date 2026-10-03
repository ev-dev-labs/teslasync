import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertSpeedFromSI } from '@/lib/unitConversion';

interface SpeedProps {
  /** Caller-supplied speed in mph. Normalised to SI m/s before display. */
  mph?: number | null;
  /** Alternative caller-supplied speed in km/h. Normalised to SI m/s before display. */
  kmh?: number | null;
  precision?: number;
  className?: string;
}

/**
 * Speed renderer that respects the user's metric/imperial preference.
 * Hover title shows the source-unit value at the requested display precision.
 */
export function Speed({ mph, kmh, precision, className }: SpeedProps) {
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const toSpeedDisplay = (mps: number) => convertSpeedFromSI(mps, unitPrefs.speed);

  // `sourceMps` holds the caller value normalised to SI meters-per-second — the
  // unit `convertSpeedFromSI` expects — regardless of which input prop was used.
  let sourceMps: number | null = null;
  let title: string | undefined;
  if (mph != null && Number.isFinite(mph)) {
    sourceMps = mph * 0.44704;
    title = `${fmtNumber(mph, precision)} mph`;
  } else if (kmh != null && Number.isFinite(kmh)) {
    sourceMps = (kmh * 1000) / 3600;
    title = `${fmtNumber(kmh, precision)} km/h`;
  }

  if (sourceMps == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(toSpeedDisplay(sourceMps), precision);
  return (
    <span className={className} title={title}>
      {display} {speedUnit}
    </span>
  );
}
