import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FormattedReading, type FormattedReadingOptions } from './FormattedReading';

interface FormattedNumberProps extends FormattedReadingOptions {
  value: number | null | undefined;
  precision?: number;
  /** Optional unit suffix appended after a single space. */
  unit?: string;
}

/**
 * Generic locale-aware number renderer. Use the unit-aware components
 * (`Distance`, `Speed`, `Energy`, etc.) when a domain unit applies.
 */
export function FormattedNumber({ value, precision, unit, label, className }: FormattedNumberProps) {
  const { fmtNumber } = useNumberFormatting();
  if (value == null || !Number.isFinite(value)) {
    return <FormattedReading label={label} className={className}>—</FormattedReading>;
  }
  const display = `${fmtNumber(value, precision)}${unit ? ` ${unit}` : ''}`;
  return <FormattedReading label={label} className={className} title={display}>{display}</FormattedReading>;
}
