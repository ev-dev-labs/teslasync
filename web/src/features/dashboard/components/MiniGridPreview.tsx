import { cn } from '@/lib/cn';
import { GRID_COLS } from '../hooks/useDashboardLayout';
import { getWidgetDef } from '../widgets/registry';
import type { SavedDashboard } from '../widgets/types';

interface MiniGridPreviewProps {
  dashboard: SavedDashboard;
  className?: string;
}

export function MiniGridPreview({ dashboard, className }: MiniGridPreviewProps) {
  const lgLayout = dashboard.layouts.lg ?? [];
  const cols = GRID_COLS.lg; // 4

  const maxY = lgLayout.length > 0
    ? Math.max(...lgLayout.map((l) => l.y + l.h))
    : 2;

  // Guard against zero/NaN maxY
  const safeMaxY = maxY > 0 && Number.isFinite(maxY) ? maxY : 2;

  return (
    <div
      className={cn(
        'relative w-full bg-white/[0.02] rounded-lg border border-white/[0.06] overflow-hidden',
        className,
      )}
      style={{ aspectRatio: `${cols} / ${safeMaxY}` }}
    >
      {lgLayout.map((item) => {
        const widget = dashboard.widgets.find((w) => w.id === item.i);
        const def = widget ? getWidgetDef(widget.widgetId) : null;
        const Icon = def?.icon;
        return (
          <div
            key={item.i}
            className="absolute rounded-sm bg-white/[0.06] border border-white/[0.08]
              flex items-center justify-center transition-colors"
            style={{
              left: `${(item.x / cols) * 100}%`,
              top: `${(item.y / safeMaxY) * 100}%`,
              width: `${(item.w / cols) * 100}%`,
              height: `${(item.h / safeMaxY) * 100}%`,
              padding: '2px',
            }}
          >
            {Icon && <Icon className="h-3 w-3 text-white/20" />}
          </div>
        );
      })}
    </div>
  );
}
