import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface VoltageProps {
  volts?: number | null;
  precision?: number;
  className?: string;
}

/** Voltage renderer with locale-aware number formatting. */
export function Voltage({ volts, precision, className }: VoltageProps) {
  const { fmtNumber } = useNumberFormatting();
  if (volts == null || !Number.isFinite(volts)) {
    return <span className={className}>—</span>;
  }
  return (
    <span className={className} title={`${fmtNumber(volts, precision)} V`}>
      {fmtNumber(volts, precision)} V
    </span>
  );
}
