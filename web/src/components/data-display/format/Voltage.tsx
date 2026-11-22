import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FormattedReading, type FormattedReadingOptions } from './FormattedReading';

interface VoltageProps extends FormattedReadingOptions {
  volts?: number | null;
  precision?: number;
}

/** Voltage renderer with locale-aware number formatting. */
export function Voltage({ volts, precision, label, className }: VoltageProps) {
  const { fmtNumber } = useNumberFormatting();
  if (volts == null || !Number.isFinite(volts)) {
    return <FormattedReading label={label} className={className}>—</FormattedReading>;
  }
  const display = `${fmtNumber(volts, precision)} V`;
  return <FormattedReading label={label} className={className} title={display}>{display}</FormattedReading>;
}
