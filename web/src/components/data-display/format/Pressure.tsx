import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertPressureFromSI } from '@/lib/unitConversion';

interface PressureProps {
  /**
   * Canonical input in bar. Matches the convention used by
   * `useSettings.toPressureDisplay(bar)`.
   */
  bar?: number | null;
  /** Alternative input in PSI; converted to bar before display. */
  psi?: number | null;
  precision?: number;
  className?: string;
}

/**
 * Pressure renderer that respects the user's bar/psi preference.
 * Hover title shows the raw caller-supplied value with its source unit.
 */
export function Pressure({ bar, psi, precision, className }: PressureProps) {
  const { unitPrefs } = useUnits();
  const pressureUnit = unitPrefs.pressure;
  const toPressureDisplay = (value: number) => convertPressureFromSI(value, unitPrefs.pressure);

  // Normalise both accepted inputs to SI kilopascals — the unit
  // `convertPressureFromSI` consumes (1 bar = 100 kPa, 1 psi = 6.894757 kPa).
  let sourceKpa: number | null = null;
  let title: string | undefined;
  if (bar != null && Number.isFinite(bar)) {
    sourceKpa = bar * 100;
    title = `${bar.toFixed(2)} bar`;
  } else if (psi != null && Number.isFinite(psi)) {
    sourceKpa = psi * 6.894757;
    title = `${psi.toFixed(2)} psi`;
  }

  if (sourceKpa == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(toPressureDisplay(sourceKpa), precision);
  return (
    <span className={className} title={title}>
      {display} {pressureUnit}
    </span>
  );
}
