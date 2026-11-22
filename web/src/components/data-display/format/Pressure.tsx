import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertPressureFromSI } from '@/lib/unitConversion';
import { FormattedReading, type FormattedReadingOptions } from './FormattedReading';

interface PressureProps extends FormattedReadingOptions {
  /**
   * Canonical input in bar. Matches the convention used by
   * `useSettings.toPressureDisplay(bar)`.
   */
  bar?: number | null;
  /** Alternative input in PSI; converted to bar before display. */
  psi?: number | null;
  precision?: number;
}

/**
 * Pressure renderer that respects the user's bar/psi preference.
 * Hover title shows the source-unit value at the requested display precision.
 */
export function Pressure({ bar, psi, precision, label, className }: PressureProps) {
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const pressureUnit = unitPrefs.pressure;
  const toPressureDisplay = (value: number) => convertPressureFromSI(value, unitPrefs.pressure);

  // Normalise both accepted inputs to SI kilopascals — the unit
  // `convertPressureFromSI` consumes (1 bar = 100 kPa, 1 psi = 6.894757 kPa).
  let sourceKpa: number | null = null;
  let title: string | undefined;
  if (bar != null && Number.isFinite(bar)) {
    sourceKpa = bar * 100;
    title = `${fmtNumber(bar, precision)} bar`;
  } else if (psi != null && Number.isFinite(psi)) {
    sourceKpa = psi * 6.894757;
    title = `${fmtNumber(psi, precision)} psi`;
  }

  if (sourceKpa == null) {
    return <FormattedReading label={label} className={className}>—</FormattedReading>;
  }

  const display = fmtNumber(toPressureDisplay(sourceKpa), precision);
  return (
    <FormattedReading label={label} className={className} title={title}>
      {`${display} ${pressureUnit}`}
    </FormattedReading>
  );
}
