import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { chartTokens } from '@/lib/tokens';
import { heatmapColor, heatmapTextColor, type HeatmapLevel } from '@/lib/heatmap';

interface HeatmapCellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'title'> {
  level: HeatmapLevel | null;
  label: string;
}

export function HeatmapCell({ level, label, className, ...props }: HeatmapCellProps) {
  return (
    <div
      {...props}
      data-app-part="chart-plot"
      data-chart-family="heatmap"
      role="img"
      aria-label={label}
      title={label}
      data-heatmap-level={level ?? undefined}
      data-heatmap-state={level == null ? 'unavailable' : level === 0 ? 'idle' : 'active'}
      className={cn(
        chartTokens.heatmap.cell,
        level == null && 'border-dashed',
        className,
      )}
      style={{ backgroundColor: heatmapColor(level), color: heatmapTextColor(level) }}
    />
  );
}
