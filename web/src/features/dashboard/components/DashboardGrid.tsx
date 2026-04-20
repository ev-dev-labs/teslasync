import { Suspense, useState, useCallback, useMemo, useRef, Component as ReactComponent, type ErrorInfo, type ReactNode } from 'react';
import {
  ResponsiveGridLayout, useContainerWidth, verticalCompactor,
  type Layout as RGLLayoutArray, type ResponsiveLayouts,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  GripVertical, X, Settings, Maximize2, Minimize2,
} from 'lucide-react';
import { GlassPanel, Button } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import { getWidgetDef } from '../widgets/registry';
import {
  GRID_BREAKPOINTS, GRID_COLS, ROW_HEIGHT, GRID_MARGIN,
} from '../hooks/useDashboardLayout';
import type { SavedDashboard, WidgetDef, WidgetInstance, RGLLayouts } from '../widgets/types';

/* ─── Types ─── */
interface DashboardGridProps {
  dashboard: SavedDashboard;
  editMode: boolean;
  onLayoutChange: (layouts: RGLLayouts) => void;
  onRemoveWidget: (instanceId: string) => void;
  onOpenSettings: (instanceId: string) => void;
  getWidgetSize: (instanceId: string) => { cols: number; rows: number };
}

/* ─── Error Boundary ─── */
interface WEBProps { name: string; children: ReactNode }
interface WEBState { hasError: boolean }

class WidgetErrorBoundary extends ReactComponent<WEBProps, WEBState> {
  state: WEBState = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Errors logged by React
  }
  render() {
    if (this.state.hasError) {
      return (
        <GlassPanel className="h-full flex items-center justify-center">
          <EmptyState message={`${this.props.name} failed to load`} />
        </GlassPanel>
      );
    }
    return this.props.children;
  }
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
          flex items-center justify-between px-3 cursor-grab
          opacity-0 group-hover:opacity-100 transition-opacity rounded-t-xl"
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 text-white/40" />
          <span className="text-[11px] text-white/50 font-medium">{def.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onSettings(); }}
            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
            aria-label={`Settings for ${def.name}`}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1 rounded hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
            aria-label={`Remove ${def.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
        <Button variant="ghost" size="sm" onClick={onClose}>
          <Minimize2 className="h-4 w-4 mr-1" /> Exit Fullscreen
        </Button>
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
  getWidgetSize,
}: DashboardGridProps) {
  const [fullscreenWidget, setFullscreenWidget] = useState<string | null>(null);
  const layoutRef = useRef<RGLLayouts>(dashboard.layouts);

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

  // Persist only on drag/resize stop (v2 EventCallback signature)
  const handleDragStop = useCallback(() => {
    onLayoutChange(layoutRef.current);
  }, [onLayoutChange]);

  const handleResizeStop = useCallback(() => {
    onLayoutChange(layoutRef.current);
  }, [onLayoutChange]);

  // Track layout changes in ref (v2: layout is LayoutItem[], layouts is ResponsiveLayouts)
  const handleLayoutChange = useCallback((_layout: RGLLayoutArray, allLayouts: ResponsiveLayouts) => {
    layoutRef.current = allLayouts as RGLLayouts;
  }, []);

  const fullscreenInstance = fullscreenWidget
    ? dashboard.widgets.find((w) => w.id === fullscreenWidget)
    : null;
  const fullscreenDef = fullscreenInstance
    ? getWidgetDef(fullscreenInstance.widgetId)
    : null;

  return (
    <>
      <div ref={containerRef as React.RefObject<HTMLDivElement>}>
      <ResponsiveGridLayout
        width={width}
        layouts={dashboard.layouts}
        breakpoints={GRID_BREAKPOINTS}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        dragConfig={dragConfig}
        resizeConfig={resizeConfig}
        compactor={verticalCompactor}
        onLayoutChange={handleLayoutChange}
        onDragStop={handleDragStop}
        onResizeStop={handleResizeStop}
        margin={GRID_MARGIN}
        containerPadding={[0, 0]}
      >
        {dashboard.widgets.map((widget) => {
          const def = getWidgetDef(widget.widgetId);
          if (!def) return null;
          const Component = def.component;
          const size = getWidgetSize(widget.id);

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
                <button
                  onClick={() => setFullscreenWidget(widget.id)}
                  className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-black/40
                    text-white/30 hover:text-white/70 hover:bg-black/60
                    opacity-0 group-hover:opacity-100 transition-all"
                  aria-label={`Expand ${def.name}`}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              )}

              {/* Visual resize affordance bar at bottom edge in edit mode */}
              {editMode && (
                <div className="absolute bottom-0 left-0 right-0 h-1.5 z-20
                  bg-gradient-to-r from-transparent via-[var(--theme-primary)]/20 to-transparent
                  opacity-0 group-hover:opacity-100 transition-opacity rounded-b-xl pointer-events-none" />
              )}

              <GlassPanel className="h-full w-full overflow-hidden rounded-xl">
                <WidgetErrorBoundary name={def.name}>
                  <Suspense
                    fallback={
                      <div className="h-full flex items-center justify-center">
                        <Skeleton className="h-3/4 w-3/4 rounded-xl" />
                      </div>
                    }
                  >
                    <Component
                      vehicleId={widget.config?.vehicleId}
                      config={widget.config}
                      size={size}
                    />
                  </Suspense>
                </WidgetErrorBoundary>
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
          getWidgetSize={getWidgetSize}
        />
      )}
    </>
  );
}
