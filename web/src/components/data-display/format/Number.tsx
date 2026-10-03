import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtNumber } = useNumberFormatting();
  if (value == null || !Number.isFinite(value)) {
    return <span className={className}>—</span>;
  }
  const suffix = unit ? ` ${unit}` : '';
  const display = fmtNumber(value, precision);
  return (
    <span className={className} title={`${display}${suffix}`}>
      {display}{suffix}
    </span>
  );
}
