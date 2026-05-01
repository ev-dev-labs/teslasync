import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { fahrenheitToCelsius } from '@/lib/unitConversion';

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
  const { convertTemp, tempUnit } = useSettings();

  let sourceC: number | null = null;
  let title: string | undefined;
  if (c != null && Number.isFinite(c)) {
    sourceC = c;
    title = `${c.toFixed(1)} °C`;
  } else if (f != null && Number.isFinite(f)) {
    sourceC = fahrenheitToCelsius(f);
    title = `${f.toFixed(1)} °F`;
  }

  if (sourceC == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(convertTemp(sourceC), precision);
  return (
    <span className={className} title={title}>
      {display}{tempUnit}
    </span>
  );
}
