import { fmtNumber } from '@/lib/numberFormat';

interface PercentageProps {
  /** Already a percentage value, e.g. SoC of 85 → "85%". */
  value?: number | null;
  /** A 0–1 ratio; multiplied by 100 before display. */
  ratio?: number | null;
  precision?: number;
  className?: string;
}

/** Percentage renderer that accepts either a percentage or a 0–1 ratio. */
export function Percentage({ value, ratio, precision, className }: PercentageProps) {
  let v: number | null = null;
  if (value != null && Number.isFinite(value)) {
    v = value;
  } else if (ratio != null && Number.isFinite(ratio)) {
    v = ratio * 100;
  }

  if (v == null) {
    return <span className={className}>—</span>;
  }

  return (
    <span className={className} title={`${v.toFixed(3)}%`}>
      {fmtNumber(v, precision)}%
    </span>
  );
}
