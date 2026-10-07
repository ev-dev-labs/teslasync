import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
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
 * Hover title shows the raw caller-supplied value with its source unit.
 */
export function Temperature({ c, f, precision, className }: TemperatureProps) {
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  let sourceC: number | null = null;
  let title: string | undefined;
  if (c != null && Number.isFinite(c)) {
    sourceC = c;
    title = `${c.toFixed(1)} °C`;
  } else if (f != null && Number.isFinite(f)) {
    sourceC = ((f - 32) * 5) / 9;
    title = `${f.toFixed(1)} °F`;
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
