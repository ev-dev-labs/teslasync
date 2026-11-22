import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FormattedReading, type FormattedReadingOptions } from './FormattedReading';

interface PercentageProps extends FormattedReadingOptions {
  /** Already a percentage value, e.g. SoC of 85 → "85%". */
  value?: number | null;
  /** A 0–1 ratio; multiplied by 100 before display. */
  ratio?: number | null;
  precision?: number;
}

/** Percentage renderer that accepts either a percentage or a 0–1 ratio. */
export function Percentage({ value, ratio, precision, label, className }: PercentageProps) {
  const { fmtPercent } = useNumberFormatting();
  let v: number | null = null;
  if (value != null && Number.isFinite(value)) {
    v = value;
  } else if (ratio != null && Number.isFinite(ratio)) {
    v = ratio * 100;
  }

  if (v == null) {
    return <FormattedReading label={label} className={className}>—</FormattedReading>;
  }

  const display = fmtPercent(v, precision);
  return <FormattedReading label={label} className={className} title={display}>{display}</FormattedReading>;
}
