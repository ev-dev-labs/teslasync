import { Caption } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HEATMAP_LEVELS, heatmapColor } from '@/lib/heatmap';
import { chartTokens } from '@/lib/tokens';
import { HeatmapCell } from './HeatmapCell';

interface HeatmapLegendProps {
  label: string;
  less: string;
  more: string;
  unavailable?: string;
}

export function HeatmapLegend({ label, less, more, unavailable }: HeatmapLegendProps) {
  return (
    <div data-app-part="chart-legend" data-chart-family="heatmap" role="group" aria-label={label} className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
      {unavailable && (
        <span className="mr-3 flex items-center gap-1.5">
          <HeatmapCell level={null} label={unavailable} className="h-3.5 w-3.5 shrink-0" />
          <Caption>{unavailable}</Caption>
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <Caption>{less}</Caption>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {HEATMAP_LEVELS.map(level => (
            <span key={level} data-heatmap-level={level} className={cn('h-3.5 w-3.5', chartTokens.heatmap.cell)}
              style={{ backgroundColor: heatmapColor(level) }} />
          ))}
        </span>
        <Caption>{more}</Caption>
      </span>
    </div>
  );
}
