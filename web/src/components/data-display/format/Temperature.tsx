import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertTempFromSI } from '@/lib/unitConversion';

interface TemperatureProps {
  /** Canonical input in °C. */
  c?: number | null;
  /** Alternative input in °F; converted to °C before display. */
  f?: number | null;
  precision?: number;
  className?: string;
}

/**
 * Temperature renderer that respects the user's °C/°F preference.
 * Hover title shows the source-unit value at the requested display precision.
 */
export function Temperature({ c, f, precision, className }: TemperatureProps) {
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  let sourceC: number | null = null;
  let title: string | undefined;
  if (c != null && Number.isFinite(c)) {
    sourceC = c;
    title = `${fmtNumber(c, precision)} °C`;
  } else if (f != null && Number.isFinite(f)) {
    sourceC = ((f - 32) * 5) / 9;
    title = `${fmtNumber(f, precision)} °F`;
  }

  if (sourceC == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(toTemperatureDisplay(sourceC), precision);
  return (
    <span className={className} title={title}>
      {display}{tempUnit}
    </span>
  );
}
