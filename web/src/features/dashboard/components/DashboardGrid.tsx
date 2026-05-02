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
import { cn } from '@/lib/cn';
import { GlassPanel, Button as UiButton } from '@/components/ui';
import { Skeleton, SectionErrorBoundary } from '@/components/feedback';
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
          <GripHorizontal className="h-3.5 w-3.5 text-white/40" />
          <span className="text-[11px] text-white/50 font-medium">{def.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onSettings(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-auto p-1 rounded text-white/40 hover:bg-white/10 hover:text-white/70 transition-colors"
            aria-label={`Settings for ${def.name}`}
          >
            <Settings className="h-3.5 w-3.5" />
          </UiButton>
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-auto p-1 rounded text-white/40 hover:bg-red-500/20 hover:text-red-400 transition-colors"
            aria-label={`Remove ${def.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </UiButton>
        </div>
      </div>

      {/* Resize indicator */}
      <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-50 transition-opacity">
        <Maximize2 className="h-3 w-3 text-white/30" />
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

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl p-6 flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-white/90">{def.name}</h2>
        <UiButton variant="ghost" size="sm" onClick={onClose}>
          <Minimize2 className="h-4 w-4 mr-1" /> Exit Fullscreen
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
  const [fullscreenWidget, setFullscreenWidget] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Local layout state breaks the controlled-component feedback loop:
  // RGL renders from liveLayouts (always up-to-date), while dashboard.layouts
  // is only read when syncing from external changes.
  const [liveLayouts, setLiveLayouts] = useState<RGLLayouts>(dashboard.layouts);
  const layoutRef = useRef<RGLLayouts>(dashboard.layouts);
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
    setLiveLayouts(dashboard.layouts);
    layoutRef.current = dashboard.layouts;
  }, [dashboard.layouts]);

  // react-grid-layout v2: hook provides containerRef + measured width
  const { containerRef, width } = useContainerWidth({ initialWidth: 1200 });

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

  // Compute widget size from live layouts so widgets adapt during resize
  const getWidgetSizeLive = useCallback((instanceId: string): { cols: number; rows: number } => {
    const lgLayout = (liveLayouts.lg ?? []) as RGLLayout[];
    const item = lgLayout.find((l) => l.i === instanceId);
    if (item) return { cols: item.w, rows: item.h };
    const widget = dashboard.widgets.find((w) => w.id === instanceId);
    const def = widget ? getWidgetDef(widget.widgetId) : undefined;
    return def?.defaultSize ?? { cols: 1, rows: 1 };
  }, [liveLayouts, dashboard.widgets]);

  // Kiosk panel background boost: increases GlassPanel bg from default 5% white
  const kioskPanelStyle = useMemo(() => {
    if (kioskWidgetOpacity == null) return undefined;
    // Scale from bg-white/8 at 0.3 to bg-white/20 at 1.0 for readability
    const alpha = 0.03 + kioskWidgetOpacity * 0.17;
    const blur = 4 + kioskWidgetOpacity * 12;
    return {
      backgroundColor: `rgba(255, 255, 255, ${alpha.toFixed(3)})`,
      backdropFilter: `blur(${blur.toFixed(1)}px)`,
    };
  }, [kioskWidgetOpacity]);

  const fullscreenInstance = fullscreenWidget
    ? dashboard.widgets.find((w) => w.id === fullscreenWidget)
    : null;
  const fullscreenDef = fullscreenInstance
    ? getWidgetDef(fullscreenInstance.widgetId)
    : null;

  return (
    <>
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className={cn('relative', editMode && 'edit-mode', isDragging && 'dragging-active')}
      >
      {/* Edit mode grid dot pattern */}
      {editMode && (
        <div
          className="absolute inset-0 pointer-events-none z-0 rounded-xl"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      )}
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
        {dashboard.widgets.map((widget) => {
          const def = getWidgetDef(widget.widgetId);
          if (!def) return null;
          const Component = def.component;
          const size = getWidgetSizeLive(widget.id);

          return (
            <div key={widget.id} className="widget-container relative group">
              {/* Edit mode chrome */}
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
                  className="absolute top-2 right-2 z-10 h-auto p-1.5 rounded-lg bg-black/40
                    text-white/30 hover:text-white/70 hover:bg-black/60
                    opacity-0 group-hover:opacity-100 transition-all"
                  aria-label={`Expand ${def.name}`}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </UiButton>
              )}

              {/* Visual resize affordance bar at bottom edge in edit mode */}
              {editMode && (
                <div className="absolute bottom-0 left-0 right-0 h-1.5 z-20
                  bg-gradient-to-r from-transparent via-[var(--theme-primary)]/20 to-transparent
                  opacity-0 group-hover:opacity-100 transition-opacity rounded-b-xl pointer-events-none" />
              )}

              <GlassPanel
                className={cn(
                  'h-full w-full overflow-y-auto rounded-xl',
                  showWidgetBorders && 'border border-white/10',
                )}
                style={kioskPanelStyle}
              >
                <SectionErrorBoundary
                  name={`widget:${def.id}:${widget.id}`}
                  fallbackTitle={`${def.name} failed to load`}
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
        })}
      </ResponsiveGridLayout>
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
