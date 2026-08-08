import { Suspense, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ResponsiveGridLayout, useContainerWidth, verticalCompactor,
  type Layout as RGLLayoutArray, type ResponsiveLayouts,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  GripHorizontal, X, Settings, Maximize2, Minimize2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel, Button as UiButton } from '@/components/ui';
import { EmptyState, Skeleton, SectionErrorBoundary } from '@/components/feedback';
import { getWidgetDef } from '../widgets/registry';
import {
  GRID_BREAKPOINTS, GRID_COLS, ROW_HEIGHT, GRID_MARGIN,
} from '../hooks/useDashboardLayout';
import type { SavedDashboard, WidgetDef, WidgetInstance, RGLLayout, RGLLayouts } from '../widgets/types';

/* ─── Types ─── */
interface DashboardGridProps {
  dashboard: SavedDashboard;
  editMode: boolean;
  onLayoutChange: (layouts: RGLLayouts) => void;
  onRemoveWidget: (instanceId: string) => void;
  onOpenSettings: (instanceId: string) => void;
  getWidgetSize: (instanceId: string) => { cols: number; rows: number };
  /** Dashboard-level vehicle filter (widgets inherit unless they have their own) */
  dashboardVehicleId?: number;
  /** Reduce grid gaps when compact mode is on */
  compactMode?: boolean;
  /** Show a subtle border on each widget */
  showWidgetBorders?: boolean;
  /** Kiosk mode widget opacity boost (0.3–1.0). Increases GlassPanel background. */
  kioskWidgetOpacity?: number;
}

/* Stable empty fallbacks so a malformed dashboard (undefined widgets/layouts —
   e.g. from corrupt localStorage or a partial API response) renders an empty
   state instead of throwing on `.map` / breakpoint indexing. Module-scoped so
   the reference stays stable across renders (memo/effect deps don't churn). */
const EMPTY_WIDGETS: WidgetInstance[] = [];
const EMPTY_LAYOUTS: RGLLayouts = {};

/* ─── Widget Chrome (edit mode overlay) ─── */
function WidgetChrome({
  def,
  onRemove,
  onSettings,
}: {
  widget: WidgetInstance;
  def: WidgetDef;
  onRemove: () => void;
  onSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 z-10 pointer-events-none group-hover:pointer-events-auto">
      {/* Drag handle at top */}
      <div
        className="widget-drag-handle absolute top-0 left-0 right-0 h-8
          bg-gradient-to-b from-black/60 to-transparent
          flex items-center justify-between px-3 cursor-grab active:cursor-grabbing
          opacity-0 group-hover:opacity-100 transition-opacity rounded-t-xl"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-secondary)] font-medium">{def.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onSettings(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-auto p-1 rounded text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)] transition-colors"
            aria-label={t('dashboard.grid.settingsLabel', 'Settings for {{name}}', { name: def.name })}
          >
            <Settings className="h-3.5 w-3.5" />
          </UiButton>
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-auto p-1 rounded text-[var(--text-muted)] hover:bg-red-500/20 hover:text-red-400 transition-colors"
            aria-label={t('dashboard.grid.removeLabel', 'Remove {{name}}', { name: def.name })}
          >
            <X className="h-3.5 w-3.5" />
          </UiButton>
        </div>
      </div>

      {/* Resize indicator */}
      <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-50 transition-opacity">
        <Maximize2 className="h-3 w-3 text-[var(--text-muted)]" />
      </div>

      {/* Hover border */}
      <div className="absolute inset-0 rounded-xl border-2 border-transparent
        group-hover:border-[var(--theme-primary)]/30 transition-colors pointer-events-none" />
    </div>
  );
}

/* ─── Fullscreen Overlay ─── */
interface FullscreenOverlayProps {
  widget: WidgetInstance;
  def: WidgetDef;
  onClose: () => void;
  getWidgetSize: (id: string) => { cols: number; rows: number };
}

function FullscreenOverlay({ widget, def, onClose, getWidgetSize }: FullscreenOverlayProps) {
  const Component = def.component;
  const size = getWidgetSize(widget.id);
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 bg-[var(--surface-overlay)] backdrop-blur-xl p-6 flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{def.name}</h2>
        <UiButton variant="ghost" size="sm" onClick={onClose}>
          <Minimize2 className="h-4 w-4 mr-1" /> {t('dashboard.grid.exitFullscreen', 'Exit Fullscreen')}
        </UiButton>
      </div>
      <GlassPanel className="flex-1 overflow-hidden">
        <Suspense fallback={<Skeleton className="h-full" />}>
          <Component
            vehicleId={widget.config?.vehicleId}
            config={widget.config}
            size={{ cols: size.cols, rows: Math.max(size.rows, 4) }}
          />
        </Suspense>
      </GlassPanel>
    </div>
  );
}

/* ─── Main Grid ─── */
export function DashboardGrid({
  dashboard,
  editMode,
  onLayoutChange,
  onRemoveWidget,
  onOpenSettings,
  dashboardVehicleId,
  compactMode,
  showWidgetBorders,
  kioskWidgetOpacity,
}: DashboardGridProps) {
  const { t } = useTranslation();
  // Null-safety: a malformed dashboard (corrupt localStorage, partial API
  // response) can arrive without widgets/layouts. Fall back to stable empty
  // references so we never call `.map` / index a breakpoint on undefined.
  const widgets = dashboard.widgets ?? EMPTY_WIDGETS;
  const [fullscreenWidget, setFullscreenWidget] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Local layout state breaks the controlled-component feedback loop:
  // RGL renders from liveLayouts (always up-to-date), while dashboard.layouts
  // is only read when syncing from external changes.
  const [liveLayouts, setLiveLayouts] = useState<RGLLayouts>(dashboard.layouts ?? EMPTY_LAYOUTS);
  const layoutRef = useRef<RGLLayouts>(dashboard.layouts ?? EMPTY_LAYOUTS);
  const interactingRef = useRef(false);

  // Track persist cycles to avoid syncing our own changes back
  const persistCountRef = useRef(0);
  const syncedCountRef = useRef(0);

  // Sync from parent state when not actively dragging/resizing
  // and when the change didn't originate from our own persist.
  // Covers: undo/redo, auto-arrange, add/remove widget, reset, import, dashboard switch.
  useEffect(() => {
    if (interactingRef.current) return;
    // Skip if this is our own persist echoing back
    if (syncedCountRef.current < persistCountRef.current) {
      syncedCountRef.current = persistCountRef.current;
      return;
    }
    setLiveLayouts(dashboard.layouts ?? EMPTY_LAYOUTS);
    layoutRef.current = dashboard.layouts ?? EMPTY_LAYOUTS;
  }, [dashboard.layouts]);

  // react-grid-layout v2: hook provides containerRef + measured width.
  // Initial width = the browser's viewport (or 1200 in SSR) so the very
  // first render already picks the correct breakpoint on mobile devices —
  // otherwise the dashboard mounts as `lg` (RGL render), then re-mounts as
  // `xs` (flex-stack render) once ResizeObserver measures the real width,
  // remounting every widget (chart/map flicker, Suspense fallback flash).
  const { containerRef, width } = useContainerWidth({
    initialWidth: typeof window !== 'undefined' ? window.innerWidth : 1200,
  });

  // v2 drag/resize config objects (stable references via useMemo)
  const dragConfig = useMemo(() => ({
    enabled: editMode,
    handle: '.widget-drag-handle',
  }), [editMode]);

  const resizeConfig = useMemo(() => ({
    enabled: editMode,
    handles: ['se', 'e', 's'] as const,
  }), [editMode]);

  // Track layout changes — only update during active drag/resize.
  // CRITICAL: layoutRef must also only update during interaction, otherwise
  // RGL's initial mount compaction overwrites saved heights in the ref,
  // and the next handleResizeStop persists the wrong values.
  const handleLayoutChange = useCallback((_layout: RGLLayoutArray, allLayouts: ResponsiveLayouts) => {
    const typed = allLayouts as RGLLayouts;
    if (interactingRef.current) {
      layoutRef.current = typed;
      setLiveLayouts(typed);
    }
  }, []);

  const handleDragStart = useCallback(() => {
    interactingRef.current = true;
    setIsDragging(true);
  }, []);

  const handleDragStop = useCallback(() => {
    setIsDragging(false);
    persistCountRef.current++;
    // Defer persist to microtask: RGL v2 fires onLayoutChange (which updates
    // layoutRef) synchronously AFTER this callback returns, so we must wait.
    queueMicrotask(() => { onLayoutChange(layoutRef.current); });
    requestAnimationFrame(() => { interactingRef.current = false; });
  }, [onLayoutChange]);

  const handleResizeStart = useCallback(() => {
    interactingRef.current = true;
  }, []);

  const handleResizeStop = useCallback(() => {
    persistCountRef.current++;
    // Defer persist to microtask: RGL v2 fires onLayoutChange (which updates
    // layoutRef) synchronously AFTER this callback returns, so we must wait.
    queueMicrotask(() => { onLayoutChange(layoutRef.current); });
    requestAnimationFrame(() => { interactingRef.current = false; });
  }, [onLayoutChange]);

  // Determine which breakpoint RGL is currently rendering for. Mirrors
  // react-grid-layout's `getBreakpointFromWidth`: pick the largest
  // breakpoint whose threshold is <= current container width. Falls back
  // to xs (the smallest) when width is 0 / unknown.
  const activeBreakpoint = useMemo(() => {
    // Order from largest threshold to smallest so the first match wins.
    const ordered = (Object.entries(GRID_BREAKPOINTS) as Array<[keyof typeof GRID_BREAKPOINTS, number]>)
      .sort((a, b) => b[1] - a[1]);
    for (const [bp, threshold] of ordered) {
      if (width >= threshold) return bp;
    }
    return 'xs' as const;
  }, [width]);

  // Compute widget size from live layouts so widgets adapt during resize.
  // Reads from the *active* breakpoint's layout (not always lg) so widgets
  // on mobile receive size.cols matching what the user actually sees,
  // which is what their compact-mode heuristics depend on.
  const getWidgetSizeLive = useCallback((instanceId: string): { cols: number; rows: number } => {
    const layout = (liveLayouts[activeBreakpoint] ?? liveLayouts.lg ?? []) as RGLLayout[];
    const item = layout.find((l) => l.i === instanceId);
    if (item) return { cols: item.w, rows: item.h };
    const widget = widgets.find((w) => w.id === instanceId);
    const def = widget ? getWidgetDef(widget.widgetId) : undefined;
    return def?.defaultSize ?? { cols: 1, rows: 1 };
  }, [liveLayouts, widgets, activeBreakpoint]);

  // ── Mobile (xs) stack mode ────────────────────────────────────────────
  //
  // On the smallest breakpoint each widget is a single full-width column
  // anyway, so RGL's fixed `h × ROW_HEIGHT` row sizing is the wrong tool —
  // it pins each widget to its desktop-sized height (e.g. vehicle-hero
  // h=9 → 720px) which leaves hundreds of pixels of *empty space* below
  // the actual widget content (each widget then renders an "elongated
  // blank space" page on a phone).
  //
  // Render the same widget JSX inside a vanilla flex column so each
  // widget's intrinsic content height drives the row height, with a
  // floor (`min-h-[12rem]` / 192px) reserved for chart and map widgets
  // whose Recharts `ResponsiveContainer height="100%"` / map canvases
  // need a definite parent height to compute against. The wrapper is a
  // flex column so descendants relying on `h-full` resolve via flex
  // stretch (default `align-items: stretch`).
  const isMobileStack = activeBreakpoint === 'xs';

  // Preserve the user's saved mobile order if they ever rearranged on
  // mobile (xs layout y/x); otherwise fall back to widget insertion
  // order so freshly-added widgets keep showing up at the bottom.
  const orderedWidgets = useMemo(() => {
    if (!isMobileStack) return widgets;
    const xsLayout = (liveLayouts.xs ?? []) as RGLLayout[];
    if (xsLayout.length === 0) return widgets;
    const orderMap = new Map<string, number>();
    xsLayout.forEach((l, i) => {
      // Encode (y, x, index) into a single sortable scalar so equal y/x
      // values fall back to layout-array order for determinism.
      orderMap.set(l.i, l.y * 10000 + l.x * 100 + i / 1000);
    });
    return [...widgets].sort((a, b) => {
      const aOrder = orderMap.get(a.id);
      const bOrder = orderMap.get(b.id);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return 0;
    });
  }, [isMobileStack, widgets, liveLayouts.xs]);

  // Kiosk panel background boost: increases GlassPanel bg from default 5% white
  const kioskPanelStyle = useMemo(() => {
    if (kioskWidgetOpacity == null) return undefined;
    // Scale from bg-[var(--surface-2)] at 0.3 to bg-[var(--surface-2)] at 1.0 for readability
    const alpha = 0.03 + kioskWidgetOpacity * 0.17;
    const blur = 4 + kioskWidgetOpacity * 12;
    return {
      backgroundColor: `rgba(255, 255, 255, ${alpha.toFixed(3)})`,
      backdropFilter: `blur(${blur.toFixed(1)}px)`,
    };
  }, [kioskWidgetOpacity]);

  const fullscreenInstance = fullscreenWidget
    ? widgets.find((w) => w.id === fullscreenWidget)
    : null;
  const fullscreenDef = fullscreenInstance
    ? getWidgetDef(fullscreenInstance.widgetId)
    : null;

  // Render a single widget's body. Used by both the desktop RGL grid path
  // and the mobile flex-stack path so behaviour stays in sync. The
  // `mobile` flag swaps `h-full` (RGL gives a definite height) for a
  // flex-1/min-h pair (mobile auto-height parent gives a min-height
  // floor that descendants resolve via flex stretch).
  const renderWidgetBody = useCallback((widget: WidgetInstance, mobile: boolean) => {
    const def = getWidgetDef(widget.widgetId);
    if (!def) return null;
    const Component = def.component;
    const size = getWidgetSizeLive(widget.id);

    return (
      <div
        key={widget.id}
        className={cn(
          'widget-container relative group',
          // Mobile: become a flex column so the GlassPanel + nested
          // `h-full` widget content resolve to the wrapper's min-height.
          mobile && 'flex flex-col min-h-[12rem]',
        )}
      >
        {/* Edit mode chrome — drag handle has no effect on touch, kept
            for the settings/remove icons it also exposes. */}
        {editMode && (
          <WidgetChrome
            widget={widget}
            def={def}
            onRemove={() => onRemoveWidget(widget.id)}
            onSettings={() => onOpenSettings(widget.id)}
          />
        )}

        {/* Fullscreen button (view mode) */}
        {!editMode && (
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFullscreenWidget(widget.id)}
            className="absolute top-2 right-2 z-10 h-auto p-1.5 rounded-lg bg-[var(--surface-overlay)]
              text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)]
              opacity-0 group-hover:opacity-100 transition-all"
            aria-label={t('dashboard.grid.expandLabel', 'Expand {{name}}', { name: def.name })}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </UiButton>
        )}

        {/* Visual resize affordance — desktop edit mode only; resize
            isn't wired up on the mobile stack path. */}
        {editMode && !mobile && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 z-20
            bg-gradient-to-r from-transparent via-[var(--theme-primary)]/20 to-transparent
            opacity-0 group-hover:opacity-100 transition-opacity rounded-b-xl pointer-events-none" />
        )}

        <GlassPanel
          className={cn(
            'w-full overflow-y-auto rounded-xl',
            mobile ? 'flex-1 min-h-0' : 'h-full',
            showWidgetBorders && 'border border-[var(--border-subtle)]',
          )}
          style={kioskPanelStyle}
        >
          <SectionErrorBoundary
            name={`widget:${def.id}:${widget.id}`}
            fallbackTitle={t('dashboard.grid.widgetFailed', '{{name}} failed to load', { name: def.name })}
          >
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center">
                  <Skeleton className="h-3/4 w-3/4 rounded-xl" />
                </div>
              }
            >
              <Component
                vehicleId={widget.config?.vehicleId ?? dashboardVehicleId}
                config={widget.config}
                size={size}
              />
            </Suspense>
          </SectionErrorBoundary>
        </GlassPanel>
      </div>
    );
  }, [
    t, editMode, getWidgetSizeLive, dashboardVehicleId, kioskPanelStyle,
    showWidgetBorders, onRemoveWidget, onOpenSettings,
  ]);

  return (
    <>
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className={cn('relative', editMode && 'edit-mode', isDragging && 'dragging-active')}
      >
      {/* Edit mode grid dot pattern — only meaningful for the absolute-
          positioned RGL path; on the mobile stack widgets flow naturally. */}
      {editMode && !isMobileStack && widgets.length > 0 && (
        <div
          className="absolute inset-0 pointer-events-none z-0 rounded-xl"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      )}
      {widgets.length === 0 ? (
        // no-action: the "Add widget" floating action button rendered by the parent DashboardPage is the real trigger; this grid only lays out widgets that already exist.
        <EmptyState
          title={t('dashboard.grid.emptyTitle', 'No widgets yet')}
          message={t('dashboard.grid.emptyMessage', 'Add widgets to start building your dashboard.')}
        />
      ) : isMobileStack ? (
        <div
          className="flex flex-col gap-3"
          data-testid="dashboard-mobile-stack"
        >
          {orderedWidgets.map((widget) => renderWidgetBody(widget, true))}
        </div>
      ) : (
        <ResponsiveGridLayout
          width={width}
          layouts={liveLayouts}
          breakpoints={GRID_BREAKPOINTS}
          cols={GRID_COLS}
          rowHeight={ROW_HEIGHT}
          dragConfig={dragConfig}
          resizeConfig={resizeConfig}
          compactor={verticalCompactor}
          onLayoutChange={handleLayoutChange}
          onDragStart={handleDragStart}
          onDragStop={handleDragStop}
          onResizeStart={handleResizeStart}
          onResizeStop={handleResizeStop}
          margin={compactMode ? [8, 8] as [number, number] : GRID_MARGIN}
          containerPadding={[0, 0]}
        >
          {widgets.map((widget) => renderWidgetBody(widget, false))}
        </ResponsiveGridLayout>
      )}
      </div>

      {/* Fullscreen overlay */}
      {fullscreenInstance && fullscreenDef && (
        <FullscreenOverlay
          widget={fullscreenInstance}
          def={fullscreenDef}
          onClose={() => setFullscreenWidget(null)}
          getWidgetSize={getWidgetSizeLive}
        />
      )}
    </>
  );
}
