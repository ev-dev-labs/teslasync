import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { psiToBar } from '@/lib/unitConversion';

interface PressureProps {
  /**
   * Canonical input in bar. Matches the convention used by
   * `useSettings.convertPressure(bar)`.
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
  const { convertPressure, pressureUnit } = useSettings();

  let sourceBar: number | null = null;
  let title: string | undefined;
  if (bar != null && Number.isFinite(bar)) {
    sourceBar = bar;
    title = `${bar.toFixed(2)} bar`;
  } else if (psi != null && Number.isFinite(psi)) {
    sourceBar = psiToBar(psi);
    title = `${psi.toFixed(2)} psi`;
  }

  if (sourceBar == null) {
    return <span className={className}>—</span>;
  }

  const display = fmtNumber(convertPressure(sourceBar), precision);
  return (
    <span className={className} title={title}>
      {display} {pressureUnit}
    </span>
  );
}
