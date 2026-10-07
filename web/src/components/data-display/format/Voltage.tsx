import { fmtNumber } from '@/lib/numberFormat';

interface VoltageProps {
  volts?: number | null;
  precision?: number;
  className?: string;
}

/** Voltage renderer with locale-aware number formatting. */
export function Voltage({ volts, precision, className }: VoltageProps) {
  if (volts == null || !Number.isFinite(volts)) {
    return <span className={className}>—</span>;
  }
  return (
    <span className={className} title={`${volts.toFixed(3)} V`}>
      {fmtNumber(volts, precision)} V
    </span>
  );
}
