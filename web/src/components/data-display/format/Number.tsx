import { fmtNumber } from '@/lib/numberFormat';

interface FormattedNumberProps {
  value: number | null | undefined;
  precision?: number;
  /** Optional unit suffix appended after a single space. */
  unit?: string;
  className?: string;
}

/**
 * Generic locale-aware number renderer. Use the unit-aware components
 * (`Distance`, `Speed`, `Energy`, etc.) when a domain unit applies.
 */
export function FormattedNumber({ value, precision, unit, className }: FormattedNumberProps) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={className}>—</span>;
  }
  const display = fmtNumber(value, precision);
  return (
    <span className={className} title={`${value}`}>
      {display}{unit ? ` ${unit}` : ''}
    </span>
  );
}
