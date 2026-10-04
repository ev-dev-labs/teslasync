import { Suspense, useState, useCallback, useMemo, useRef, useEffect, type DragEvent as ReactDragEvent } from 'react';
import {
  ResponsiveGridLayout, useContainerWidth, verticalCompactor,
  type Layout as RGLLayoutArray,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button as UiButton, GlassPanel } from '@/components/ui';
import { EmptyState, Skeleton, SectionErrorBoundary } from '@/components/feedback';
import { getWidgetDef } from '../widgets/registry';
import { kioskPanelStyle } from '../lib/kioskAppearance';
import {
  GRID_BREAKPOINTS, GRID_COLS, ROW_HEIGHT, GRID_MARGIN,
  resolveBreakpointFromWidth,
  type GridBreakpoint,
} from '../hooks/useDashboardLayout';
import type { SavedDashboard, WidgetDef, WidgetInstance, RGLLayout, RGLLayouts, DropPlacement } from '../widgets/types';
import { WIDGET_DND_MIME } from '../widgets/types';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import {
  WidgetEditChrome,
} from './WidgetEditChrome';
import {
  applyWidgetArrangeAction,
  layoutsEqual,
  rowsForHeight,
  widgetArrangeAvailability,
  type WidgetArrangeAction,
  type WidgetArrangeAvailability,
} from './dashboardLayoutActions';

/* ─── Types ─── */
interface DashboardGridProps {
  dashboard: SavedDashboard;
  editMode: boolean;
  onLayoutChange: (layouts: RGLLayouts, breakpoint?: keyof typeof GRID_COLS) => void;
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
  /** Empty-state primary CTA: open the add-widget surface. */
  onAddWidgets?: () => void;
  /** Empty-state secondary CTA: open the starter-layout gallery. */
  onBrowseTemplates?: () => void;
  /** Toolbox drop: add `widgetId` at the drop-cell placement. Present only
   * when external drops are supported (desktop edit mode). */
  onDropWidget?: (widgetId: string, placement: DropPlacement, bp: GridBreakpoint) => void;
  getDraggedWidgetId?: () => string | null;
}

/* Stable empty fallbacks so a malformed dashboard (undefined widgets/layouts —
   e.g. from corrupt localStorage or a partial API response) renders an empty
   state instead of throwing on `.map` / breakpoint indexing. Module-scoped so
   the reference stays stable across renders (memo/effect deps don't churn). */
const EMPTY_WIDGETS: WidgetInstance[] = [];
const EMPTY_LAYOUTS: RGLLayouts = {};
// Placeholder identity for toolbox drag-overs. Size is a fallback —
// onDropDragOver overrides w/h per dragged widget every time.
const DROPPING_ITEM = { i: '__dropping__', x: 0, y: 0, w: 1, h: 2 };

/* ─── Fullscreen Overlay ─── */
interface FullscreenOverlayProps {
  widget: WidgetInstance;
  def: WidgetDef;
  dashboardVehicleId?: number;
  onClose: () => void;
  getWidgetSize: (id: string) => { cols: number; rows: number };
}

function FullscreenOverlay({
  widget,
  def,
  dashboardVehicleId,
  onClose,
  getWidgetSize,
}: FullscreenOverlayProps) {
  const Component = def.component;
  const size = getWidgetSize(widget.id);
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 bg-[var(--surface-overlay)] backdrop-blur-xl p-6 flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{def.name}</h2>
        <UiButton variant="ghost" size="sm" onClick={onClose}>
          <Minimize2 className="h-4 w-4 mr-1" /> {t('dashboard.grid.exitFullscreen', 'Exit fullscreen')}
        </UiButton>
      </div>
      <GlassPanel className="flex-1 overflow-hidden">
        <Suspense fallback={<Skeleton className="h-full" />}>
          <Component
            vehicleId={widget.config?.vehicleId ?? dashboardVehicleId}
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
  onAddWidgets,
  onBrowseTemplates,
  onDropWidget,
  getDraggedWidgetId,
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
  const activeBreakpointRef = useRef<keyof typeof GRID_COLS>('lg');
  // Latest saved layouts, for no-op persist detection (click-without-move
  // must not write, toast, or consume an undo entry).
  const savedLayoutsRef = useRef<RGLLayouts>(dashboard.layouts ?? EMPTY_LAYOUTS);
  savedLayoutsRef.current = dashboard.layouts ?? EMPTY_LAYOUTS;
  // Auto-fit eligibility: ids added during this session that the user has
  // never explicitly sized. Mount-time ids are loaded, not added, so they
  // never auto-fit (a reload must not undo a deliberate shrink).
  const prevWidgetIdsRef = useRef<Set<string> | null>(null);
  const prevDashboardIdRef = useRef(dashboard.id);
  const autoFitIdsRef = useRef<Set<string>>(new Set());
  const fitTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const fitObserversRef = useRef<MutationObserver[]>([]);

  // Sync from parent state. Echo detection is CONTENT-based: when the saved
  // layouts match what the grid already holds, the update is our own persist
  // echoing back and is skipped. A persist counter cannot do this job — the
  // echo routinely arrives while `interacting` is still true, the early
  // return consumes nothing, and the stale credit then eats the NEXT
  // legitimate external update (auto-arrange, undo), freezing the screen
  // while storage moves on. Content comparison cannot desync.
  // Covers: undo/redo, auto-arrange, add/remove widget, reset, import, dashboard switch.
  useEffect(() => {
    const incoming = dashboard.layouts ?? EMPTY_LAYOUTS;
    if (layoutsEqual(incoming, layoutRef.current)) {
      // Echo (or a no-op update): align the ref without re-rendering.
      if (layoutRef.current !== incoming) layoutRef.current = incoming;
      return;
    }
    // A gesture in flight owns the grid; its stop handler persists the final
    // state, which supersedes this update. (Undo mid-drag is intentionally
    // dropped — the gesture the user can see always wins.)
    if (interactingRef.current) return;
    layoutRef.current = incoming;
    setLiveLayouts(incoming);
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

  const dropConfig = useMemo(() => ({
    enabled: onDropWidget !== undefined,
    defaultItem: { w: 1, h: 2 },
  }), [onDropWidget]);

  // NOTE: `onLayoutChange` is deliberately NOT passed to RGL. Layout data
  // flows UNIDIRECTIONALLY (us → RGL): every layout we hand over is already
  // reconciled + compacted, and every legitimate change (gestures via
  // callback args, arrange buttons, auto-arrange, undo, add/remove) flows
  // back through explicit channels below — never through RGL's emissions.
  // RGL's `allLayouts` emissions are unusable as a source of truth: v2.2.4
  // regenerates non-active breakpoints as x=0 stacks on re-renders, and
  // emits w1h1 key-miss rebuilds (e.g. dashboard-switch transients) for the
  // ACTIVE breakpoint too, flapping correct↔rebuild dozens of times per
  // second. Adopting any of that poisoned `layoutRef`, corrupted storage on
  // the next gesture, and sustained a render storm. RGL renders our truth;
  // it has nothing to teach us.

  // Brief "drop flash" on the just-dropped widget so the gesture lands with
  // visible feedback. Skipped under reduced motion (the position change
  // itself is the feedback there).
  const { reduce: reduceMotion } = useMotionPreference();
  const [droppedId, setDroppedId] = useState<string | null>(null);
  const dropFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (dropFlashTimer.current) clearTimeout(dropFlashTimer.current);
  }, []);
  const flashDropped = useCallback((id: string | undefined) => {
    if (dropFlashTimer.current) clearTimeout(dropFlashTimer.current);
    if (!id || reduceMotion) {
      setDroppedId(null);
      return;
    }
    setDroppedId(id);
    dropFlashTimer.current = setTimeout(() => setDroppedId(null), 650);
  }, [reduceMotion]);

  // Persist a finished gesture. RGL passes the final compacted layout for
  // the active breakpoint as the first callback arg — persisting THAT
  // (instead of ref-sniffing across microtask/rAF hops) makes the write
  // exact by construction. No-op gestures (click without move) are dropped
  // before they can write, toast, or consume an undo entry.
  const persistGesture = useCallback((finalLayout: RGLLayoutArray | undefined, droppedItemId: string | undefined) => {
    setIsDragging(false);
    interactingRef.current = false;
    const bp = activeBreakpointRef.current;
    const merged: RGLLayouts = finalLayout
      ? { ...layoutRef.current, [bp]: (finalLayout as RGLLayout[]).map((item) => ({
          ...item,
          userSized: item.userSized || layoutRef.current[bp]?.find((saved) => saved.i === item.i)?.userSized,
        })) }
      : layoutRef.current;
    layoutRef.current = merged;
    setLiveLayouts(merged);
    flashDropped(droppedItemId);
    if (layoutsEqual(merged, savedLayoutsRef.current)) return;
    onLayoutChange(merged, bp);
  }, [flashDropped, onLayoutChange]);

  const handleDragStart = useCallback(() => {
    interactingRef.current = true;
    setIsDragging(true);
  }, []);

  const handleDragStop = useCallback((layout: RGLLayoutArray, _oldItem: unknown, newItem: { i?: unknown } | null) => {
    const id = typeof newItem?.i === 'string' ? newItem.i : undefined;
    persistGesture(layout, id);
  }, [persistGesture]);

  const handleResizeStart = useCallback(() => {
    interactingRef.current = true;
  }, []);

  const handleResizeStop = useCallback((layout: RGLLayoutArray, _oldItem: unknown, newItem: { i?: unknown } | null) => {
    const id = typeof newItem?.i === 'string' ? newItem.i : undefined;
    // An explicit user resize takes the widget out of auto-fit management —
    // from here on its size is the user's choice, even if content overflows.
    const bp = activeBreakpointRef.current;
    const before = savedLayoutsRef.current[bp]?.find((item) => item.i === id);
    const after = layout.find((item) => item.i === id);
    if (id !== undefined && before && after && (before.w !== after.w || before.h !== after.h)) {
      autoFitIdsRef.current.delete(id);
      const marked = layout.map((item) => item.i === id ? { ...item, userSized: true } : item);
      layoutRef.current = { ...layoutRef.current, [bp]: marked };
      persistGesture(marked, id);
    } else {
      persistGesture(layout, id);
    }
  }, [persistGesture]);

  // ── Docked picker drops (WidgetPicker → grid) ───────────────────────────
  //
  // The picker writes our custom MIME on dragstart; anything else (text
  // selections, files, cross-app drags) is rejected with `false` so no
  // placeholder ever appears for it. Duplicates are rejected the same way.
  // Sizes come from the registry default clamped to the active columns, so
  // the placeholder previews the true footprint.
  const handleDropDragOver = useCallback((event: ReactDragEvent) => {
    // Browsers protect DataTransfer payloads during dragover; the same-page
    // picker supplies the id until drop, when getData becomes readable.
    const widgetId = event.dataTransfer?.getData(WIDGET_DND_MIME)
      || (event.dataTransfer?.types?.includes(WIDGET_DND_MIME) ? getDraggedWidgetId?.() : null);
    if (!widgetId || !onDropWidget) return false;
    const def = getWidgetDef(widgetId);
    if (!def || widgets.some((w) => w.widgetId === widgetId)) return false;
    const cols = GRID_COLS[activeBreakpointRef.current];
    return {
      w: Math.min(def.defaultSize.cols, cols),
      h: def.defaultSize.rows,
    };
  }, [getDraggedWidgetId, onDropWidget, widgets]);

  const handleDrop = useCallback((_layout: RGLLayoutArray, item: { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined, event: Event) => {
    const widgetId = (event as DragEvent).dataTransfer?.getData(WIDGET_DND_MIME) ?? '';
    if (!widgetId || !item || !onDropWidget) return;
    const def = getWidgetDef(widgetId);
    if (!def || widgets.some((w) => w.widgetId === widgetId)) return;
    const num = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    onDropWidget(
      widgetId,
      {
        x: num(item.x, 0),
        y: num(item.y, 0),
        w: num(item.w, def.defaultSize.cols),
        h: num(item.h, def.defaultSize.rows),
      },
      activeBreakpointRef.current,
    );
  }, [onDropWidget, widgets]);

  // Which breakpoint RGL is rendering. Seeded from — and always equal to —
  // RGL's own `getBreakpointFromWidth` over the same `width` prop, via the
  // shared `resolveBreakpointFromWidth` (strict `>`: at an exact threshold
  // width `>=` would pick the larger breakpoint while RGL renders the
  // smaller one). xs renders the flex-stack path instead of RGL.
  const activeBreakpoint = useMemo(() => resolveBreakpointFromWidth(width), [width]);
  const isMobileStack = activeBreakpoint === 'xs';
  activeBreakpointRef.current = activeBreakpoint;

  // ── Auto-fit newly added widgets to their content ──────────────────────
  //
  // Fit against the widget's default-sized box rather than its live box.
  // Measuring h-full descendants inside a growing box feeds their stretched
  // height back into the next fit pass until the panel reaches maxH.
  //
  // Triggers: MutationObserver per eligible panel (lazy chunks, data fetch,
  // live updates) plus two settle passes (font/image loads don't mutate the
  // DOM). ResizeObserver can't do this job — the panel box is grid-fixed, so
  // content growth never resizes it. Repair oversized saved layouts too,
  // unless the user explicitly sized them.
  const runAutoFitPass = useCallback(() => {
    if (interactingRef.current) return;
    const root = containerRef.current;
    if (!root) return;
    const bp = activeBreakpointRef.current;
    const marginY = compactMode ? 8 : GRID_MARGIN[1];
    const current = layoutRef.current[bp] ?? [];
    let fitted: RGLLayout[] | null = null;
    for (const widget of widgets) {
      const id = widget.id;
      const item = current.find((l) => l.i === id);
      if (!item || item.userSized) continue;
      const def = getWidgetDef(widget.widgetId);
      if (!def) continue;
      const newlyAdded = autoFitIdsRef.current.has(id);
      if (!newlyAdded && item.h < Math.max(8, def.defaultSize.rows + 3)) continue;
      // Widget ids are app-generated ([A-Za-z0-9-]) — safe to interpolate.
      const panel = root.querySelector(`[data-widget-id="${id}"] > .widget-panel`);
      if (!(panel instanceof HTMLElement)) continue;
      if (panel.clientWidth === 0) continue;
      const baselineRows = Math.max(item.minH ?? def.minSize.rows, def.defaultSize.rows);
      const baselineHeight = baselineRows * ROW_HEIGHT + (baselineRows - 1) * marginY;
      const priorHeight = panel.style.height;
      const priorTransition = panel.style.getPropertyValue('transition-property');
      const priorTransitionPriority = panel.style.getPropertyPriority('transition-property');
      let contentHeight: number;
      try {
        // Even the reduced-motion 0.01ms transition delays this synchronous read.
        panel.style.setProperty('transition-property', 'none', 'important');
        panel.style.height = `${baselineHeight}px`;
        const nestedOverflow = Array.from(panel.querySelectorAll<HTMLElement>('*')).reduce((largest, element) => {
          const overflow = element.scrollHeight - element.clientHeight;
          if (overflow <= 4) return largest;
          const overflowY = getComputedStyle(element).overflowY;
          return overflowY === 'auto' || overflowY === 'scroll'
            ? Math.max(largest, overflow)
            : largest;
        }, 0);
        contentHeight = panel.clientHeight + Math.max(
          panel.scrollHeight - panel.clientHeight,
          nestedOverflow,
        );
      } finally {
        panel.style.height = priorHeight;
        // Commit the restored box before transitions can animate from the reference size.
        void panel.offsetHeight;
        if (priorTransition) {
          panel.style.setProperty('transition-property', priorTransition, priorTransitionPriority);
        } else {
          panel.style.removeProperty('transition-property');
        }
      }
      if (contentHeight <= 0) continue;
      const maxH = item.maxH ?? def.maxSize.rows;
      const hNew = Math.max(baselineRows, Math.min(rowsForHeight(contentHeight, ROW_HEIGHT, marginY), maxH));
      if (hNew === item.h || (!newlyAdded && hNew >= item.h - 1)) continue;
      fitted ??= current.map((l) => ({ ...l }));
      const target = fitted.find((l) => l.i === id);
      if (target) target.h = hNew;
    }
    if (!fitted) return;
    const merged: RGLLayouts = { ...layoutRef.current, [bp]: fitted };
    layoutRef.current = merged;
    setLiveLayouts(merged);
    onLayoutChange(merged, bp);
  }, [compactMode, onLayoutChange, widgets]);

  useEffect(() => {
    if (prevDashboardIdRef.current !== dashboard.id) {
      autoFitIdsRef.current.clear();
      prevWidgetIdsRef.current = null;
      prevDashboardIdRef.current = dashboard.id;
    }
    // Eligibility: ids present now but not on the previous run were added.
    // The first run establishes the baseline (mount = loaded, not added).
    const ids = new Set(widgets.map((w) => w.id));
    if (prevWidgetIdsRef.current) {
      for (const id of ids) {
        if (!prevWidgetIdsRef.current.has(id)) autoFitIdsRef.current.add(id);
      }
      for (const id of [...autoFitIdsRef.current]) {
        if (!ids.has(id)) autoFitIdsRef.current.delete(id);
      }
    }
    prevWidgetIdsRef.current = ids;

    const candidates = widgets.filter((widget) => {
      const item = layoutRef.current[activeBreakpoint]?.find((entry) => entry.i === widget.id);
      const def = getWidgetDef(widget.widgetId);
      if (!item || item.userSized || !def) return false;
      if (item.h >= Math.max(8, def.defaultSize.rows + 3)) {
        autoFitIdsRef.current.add(widget.id);
      }
      return autoFitIdsRef.current.has(widget.id);
    });
    if (candidates.length === 0) return;
    const timers = fitTimersRef.current;
    const observers = fitObserversRef.current;
    const schedule = (ms: number) => {
      timers.push(setTimeout(runAutoFitPass, ms));
    };
    if (
      isMobileStack || typeof MutationObserver === 'undefined'
    ) {
      return;
    }
    const root = containerRef.current;
    if (root) {
      for (const { id } of candidates) {
        const panel = root.querySelector(`[data-widget-id="${id}"] > .widget-panel`);
        if (!(panel instanceof HTMLElement)) continue;
        const observer = new MutationObserver(() => schedule(60));
        observer.observe(panel, { childList: true, subtree: true, characterData: true });
        observers.push(observer);
      }
    }
    // Settle passes: fonts/images shift scrollHeight without DOM mutations.
    schedule(80);
    schedule(800);
    return () => {
      for (const timer of timers.splice(0)) clearTimeout(timer);
      for (const observer of observers.splice(0)) observer.disconnect();
    };
  }, [activeBreakpoint, dashboard.id, widgets, isMobileStack, runAutoFitPass]);

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

  const getArrangeAvailability = useCallback((
    instanceId: string,
    def: WidgetDef,
  ): WidgetArrangeAvailability => {
    const cols = GRID_COLS[activeBreakpoint];
    const layout = (
      liveLayouts[activeBreakpoint]
      ?? liveLayouts.lg
      ?? []
    ) as RGLLayout[];
    return widgetArrangeAvailability(
      layout,
      instanceId,
      def,
      cols,
      isMobileStack,
    );
  }, [activeBreakpoint, isMobileStack, liveLayouts]);

  const arrangeWidget = useCallback((
    instanceId: string,
    action: WidgetArrangeAction,
  ): boolean => {
    const cols = GRID_COLS[activeBreakpoint];
    const current = (
      layoutRef.current[activeBreakpoint]
      ?? liveLayouts[activeBreakpoint]
      ?? layoutRef.current.lg
      ?? liveLayouts.lg
      ?? []
    ).map((item) => ({ ...item }));
    const widget = widgets.find((candidate) => candidate.id === instanceId);
    const def = widget ? getWidgetDef(widget.widgetId) : undefined;
    if (!def) return false;
    const result = applyWidgetArrangeAction(
      current,
      instanceId,
      def,
      cols,
      action,
      isMobileStack,
    );
    if (!result.changed) return false;

    // Explicit size actions end auto-fit eligibility (moves don't — a moved
    // widget still grows to fit unseen content).
    if (action.startsWith('make-')) autoFitIdsRef.current.delete(instanceId);

    const nextLayouts = {
      ...layoutRef.current,
      [activeBreakpoint]: result.layout,
    };
    // The parent's echo is recognized by content comparison,
    // so no counter bookkeeping is needed here.
    layoutRef.current = nextLayouts;
    setLiveLayouts(nextLayouts);
    onLayoutChange(nextLayouts, activeBreakpoint);
    return true;
  }, [activeBreakpoint, isMobileStack, liveLayouts, onLayoutChange, widgets]);

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

  const panelStyle = useMemo(
    () => kioskWidgetOpacity == null ? undefined : kioskPanelStyle(kioskWidgetOpacity),
    [kioskWidgetOpacity],
  );

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
        data-widget-id={widget.id}
        className={cn(
          'widget-container relative group',
          // Mobile: become a flex column so the GlassPanel + nested
          // `h-full` widget content resolve to the wrapper's min-height.
          mobile && 'flex flex-col min-h-[12rem]',
          widget.id === droppedId && 'widget-just-dropped',
        )}
      >
        {/* Edit mode chrome provides both drag handles and discrete layout controls. */}
        {editMode && (
          <WidgetEditChrome
            def={def}
            onRemove={() => onRemoveWidget(widget.id)}
            onSettings={() => onOpenSettings(widget.id)}
            onArrange={(action) => arrangeWidget(widget.id, action)}
            arrangeAvailability={getArrangeAvailability(widget.id, def)}
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
            // `widget-panel`: stable inner target for the edit-mode wobble.
            // (RGL v2 merges `react-grid-item` onto the container root, so
            // transform animations must live here, not on the item.)
            'widget-panel w-full overflow-y-auto rounded-xl',
            mobile ? 'flex flex-1 min-h-0 flex-col' : 'h-full',
            showWidgetBorders && 'border border-[var(--border-subtle)]',
            panelStyle && 'kiosk-panel',
          )}
          style={panelStyle}
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
    t, editMode, getWidgetSizeLive, dashboardVehicleId, panelStyle,
    showWidgetBorders, onRemoveWidget, onOpenSettings, arrangeWidget,
    getArrangeAvailability, droppedId,
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
        <EmptyState
          title={t('dashboard.grid.emptyTitle', 'No widgets yet')}
          message={t('dashboard.grid.emptyMessage', 'Add widgets to start building your dashboard.')}
          action={onAddWidgets
            ? { label: t('dashboard.grid.addWidgets', 'Add widgets'), onClick: onAddWidgets }
            : undefined}
          secondaryAction={onBrowseTemplates
            ? { label: t('dashboard.grid.browseTemplates', 'Browse starter layouts'), onClick: onBrowseTemplates }
            : undefined}
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
          dropConfig={dropConfig}
          droppingItem={DROPPING_ITEM}
          onDrop={handleDrop}
          onDropDragOver={handleDropDragOver}
          compactor={verticalCompactor}
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
          dashboardVehicleId={dashboardVehicleId}
          onClose={() => setFullscreenWidget(null)}
          getWidgetSize={getWidgetSizeLive}
        />
      )}
    </>
  );
}
