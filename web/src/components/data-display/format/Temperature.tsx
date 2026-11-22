import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertTempFromSI } from '@/lib/unitConversion';
import { FormattedReading, type FormattedReadingOptions } from './FormattedReading';

interface TemperatureProps extends FormattedReadingOptions {
  /** Canonical input in °C. */
  c?: number | null;
  /** Alternative input in °F; converted to °C before display. */
  f?: number | null;
  precision?: number;
}

/**
 * Temperature renderer that respects the user's °C/°F preference.
 * Hover title shows the source-unit value at the requested display precision.
 */
export function Temperature({ c, f, precision, label, className }: TemperatureProps) {
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
    return <FormattedReading label={label} className={className}>—</FormattedReading>;
  }

  const display = fmtNumber(toTemperatureDisplay(sourceC), precision);
  return (
    <FormattedReading label={label} className={className} title={title}>
      {`${display}${tempUnit}`}
    </FormattedReading>
  );
}
