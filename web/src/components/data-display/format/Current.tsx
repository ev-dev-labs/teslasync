import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface CurrentProps {
  amps?: number | null;
  precision?: number;
  className?: string;
}

/** Current (amperage) renderer with locale-aware number formatting. */
export function Current({ amps, precision, className }: CurrentProps) {
  const { fmtNumber } = useNumberFormatting();
  if (amps == null || !Number.isFinite(amps)) {
    return <span className={className}>—</span>;
  }
  return (
    <span className={className} title={`${fmtNumber(amps, precision)} A`}>
      {fmtNumber(amps, precision)} A
    </span>
  );
}
