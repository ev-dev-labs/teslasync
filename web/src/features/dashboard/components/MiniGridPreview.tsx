import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GRID_COLS } from '../hooks/useDashboardLayout';
import { getWidgetDef } from '../widgets/registry';
import type { SavedDashboard } from '../widgets/types';

interface MiniGridPreviewProps {
  dashboard: SavedDashboard;
  className?: string;
}

/** Rows assumed when a layout has no measurable height (keeps the aspect-ratio sane). */
const FALLBACK_ROWS = 2;

/** Coerce a possibly-malformed numeric coordinate into a finite value. */
function toFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A miniature, non-interactive thumbnail of a dashboard's `lg` layout. Used by
 * the template gallery, import preview, and export modal to show layout shape
 * at a glance.
 *
 * The data it renders is not always trusted — imported/pasted JSON and
 * localStorage-persisted dashboards can arrive with a missing `layouts`/
 * `widgets` field or non-finite coordinates — so every access is defended and
 * every coordinate is clamped to avoid emitting invalid `NaN%` CSS.
 */
export function MiniGridPreview({ dashboard, className }: MiniGridPreviewProps) {
  const { t } = useTranslation('dashboard');
  const cols = GRID_COLS.lg; // 4

  const { tiles, safeRows } = useMemo(() => {
    const layout = dashboard.layouts?.lg ?? [];
    const widgets = dashboard.widgets ?? [];

    // Resolve widget-instance id → registry def once so the per-tile lookup is
    // O(1) instead of scanning the ~100-entry registry for every layout item.
    const defByInstanceId = new Map<string, ReturnType<typeof getWidgetDef>>();
    for (const w of widgets) {
      defByInstanceId.set(w.id, getWidgetDef(w.widgetId));
    }

    const rawMaxY = layout.length > 0
      ? Math.max(...layout.map((l) => toFinite(l.y, 0) + toFinite(l.h, 1)))
      : FALLBACK_ROWS;
    const rows = rawMaxY > 0 && Number.isFinite(rawMaxY) ? rawMaxY : FALLBACK_ROWS;

    const computed = layout.map((item) => {
      const def = defByInstanceId.get(item.i);
      return {
        key: item.i,
        Icon: def?.icon ?? null,
        left: (toFinite(item.x, 0) / cols) * 100,
        top: (toFinite(item.y, 0) / rows) * 100,
        width: (toFinite(item.w, 1) / cols) * 100,
        height: (toFinite(item.h, 1) / rows) * 100,
      };
    });

    return { tiles: computed, safeRows: rows };
  }, [dashboard.layouts, dashboard.widgets, cols]);

  const label = t('preview.aria', 'Layout preview, {{count}} widgets', {
    count: tiles.length,
  });

  return (
    <div
      role="img"
      aria-label={label}
      data-testid="mini-grid-preview"
      className={cn(
        'relative w-full bg-white/[0.02] rounded-lg border border-white/[0.06] overflow-hidden',
        className,
      )}
      style={{ aspectRatio: `${cols} / ${safeRows}` }}
    >
      {tiles.length === 0 ? (
        <div
          data-testid="mini-grid-empty"
          aria-hidden="true"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[var(--text-muted)]"
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="text-xs">{t('preview.empty', 'No widgets')}</span>
        </div>
      ) : (
        tiles.map((tile) => {
          const Icon = tile.Icon;
          return (
            <div
              key={tile.key}
              data-testid="mini-grid-tile"
              aria-hidden="true"
              className="absolute rounded-sm bg-white/[0.06] border border-white/[0.08]
                flex items-center justify-center transition-colors p-0.5"
              style={{
                left: `${tile.left}%`,
                top: `${tile.top}%`,
                width: `${tile.width}%`,
                height: `${tile.height}%`,
              }}
            >
              {Icon && <Icon className="h-3 w-3 text-[var(--text-muted)]" />}
            </div>
          );
        })
      )}
    </div>
  );
}
