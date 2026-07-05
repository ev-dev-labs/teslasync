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
  const suffix = unit ? ` ${unit}` : '';
  const display = fmtNumber(value, precision);
  // Hover title reveals the full-precision value with its unit so the exact
  // figure stays unambiguous when the visible text is rounded — matching the
  // sibling formatters (Distance/Energy/Percentage).
  return (
    <span className={className} title={`${value}${suffix}`}>
      {display}{suffix}
    </span>
  );
}
