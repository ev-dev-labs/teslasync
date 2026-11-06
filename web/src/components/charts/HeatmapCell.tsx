import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { heatmapColor, heatmapTextColor, type HeatmapLevel } from '@/lib/heatmap';

interface HeatmapCellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'title'> {
  level: HeatmapLevel | null;
  label: string;
}

export function HeatmapCell({ level, label, className, ...props }: HeatmapCellProps) {
  return (
    <div
      {...props}
      role="img"
      aria-label={label}
      title={label}
      data-heatmap-level={level ?? undefined}
      data-heatmap-state={level == null ? 'unavailable' : level === 0 ? 'idle' : 'active'}
      className={cn(
        'rounded-[3px] border border-[var(--border-subtle)]',
        level == null && 'border-dashed',
        className,
      )}
      style={{ backgroundColor: heatmapColor(level), color: heatmapTextColor(level) }}
    />
  );
}
