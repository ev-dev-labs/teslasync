import { useTranslation } from 'react-i18next';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';

interface SegmentedMeterProps {
  value: number | null;
  max?: number;
  color?: string;
  label?: string;
  className?: string;
}

export function SegmentedMeter({ value, max = 100, color, label, className }: SegmentedMeterProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const known = value != null && Number.isFinite(value);
  const validScale = Number.isFinite(max) && max > 0;
  const inRange = known && validScale && value >= 0 && value <= max;
  const ratio = known && validScale
    ? Math.max(0, Math.min(1, value / max))
    : null;
  return (
    <div aria-hidden={label ? undefined : true} role={label ? inRange ? 'meter' : 'group' : undefined}
      aria-label={label ? `${label}: ${known ? fmtNumber(value) : t('common.noReading', 'No reading')}` : undefined}
      aria-valuenow={label && inRange ? value : undefined}
      aria-valuemin={label && inRange ? 0 : undefined}
      aria-valuemax={label && inRange ? max : undefined}
      className={cn('grid h-5 grid-cols-[repeat(20,minmax(0,1fr))] gap-0.5', className)}>
      {Array.from({ length: 20 }, (_, index) => (
        <span key={index} className="h-full overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface-2)] forced-colors:border-[CanvasText]">
          {ratio != null && <span className="block h-full bg-[var(--theme-primary)] forced-colors:!bg-[Highlight] forced-colors:[forced-color-adjust:none]"
            style={{ width: `${Math.max(0, Math.min(1, ratio * 20 - index)) * 100}%`, backgroundColor: color }} />}
        </span>
      ))}
    </div>
  );
}
