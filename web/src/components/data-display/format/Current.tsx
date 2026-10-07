import { fmtNumber } from '@/lib/numberFormat';

interface CurrentProps {
  amps?: number | null;
  precision?: number;
  className?: string;
}

/** Current (amperage) renderer with locale-aware number formatting. */
export function Current({ amps, precision, className }: CurrentProps) {
  if (amps == null || !Number.isFinite(amps)) {
    return <span className={className}>—</span>;
  }
  return (
    <span className={className} title={`${amps.toFixed(3)} A`}>
      {fmtNumber(amps, precision)} A
    </span>
  );
}
