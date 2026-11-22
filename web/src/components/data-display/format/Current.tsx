import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FormattedReading, type FormattedReadingOptions } from './FormattedReading';

interface CurrentProps extends FormattedReadingOptions {
  amps?: number | null;
  precision?: number;
}

/** Current (amperage) renderer with locale-aware number formatting. */
export function Current({ amps, precision, label, className }: CurrentProps) {
  const { fmtNumber } = useNumberFormatting();
  if (amps == null || !Number.isFinite(amps)) {
    return <FormattedReading label={label} className={className}>—</FormattedReading>;
  }
  const display = `${fmtNumber(amps, precision)} A`;
  return <FormattedReading label={label} className={className} title={display}>{display}</FormattedReading>;
}
