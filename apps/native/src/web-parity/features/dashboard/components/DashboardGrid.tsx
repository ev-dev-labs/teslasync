// DashboardGrid — native parity port of
// web/src/features/dashboard/components/DashboardGrid.tsx.
//
// The web component is a react-grid-layout (RGL) draggable/resizable widget
// board with a hand-rolled mobile fallback: on the smallest breakpoint (`xs`)
// it abandons the absolute-positioned RGL grid and renders every widget in a
// vanilla flex column so each widget's intrinsic content height drives the row
// (web L259-298, L426-432). React Native has no RGL / CSS grid / drag-resize /
// ResizeObserver, and a phone IS that smallest breakpoint, so the faithful
// native port IS that mobile-stack path: a single full-width vertical column.
//
// Native adaptations vs. the web source (behaviour/state/keys preserved; every
// source line mapped in the .parity.json sidecar):
//   - `react-grid-layout` (ResponsiveGridLayout/useContainerWidth/
//     verticalCompactor) + its two CSS imports (web L2-7) -> dropped; the grid
//     is browser-only. The desktop RGL branch (web L433-453) collapses to the
//     always-rendered native stack. Container width comes from
//     `useWindowDimensions()` instead of the RGL ResizeObserver hook.
//   - The RGL drag/resize/persist machinery — `layoutRef`, `interactingRef`,
//     `persistCountRef`, `syncedCountRef`, `dragConfig`, `resizeConfig`,
//     `handleLayoutChange`, `handleDragStart/Stop`, `handleResizeStart/Stop`,
//     `isDragging` (web L146/152-157/183-230) — is browser-grid-only. Native
//     renders a STATIC stack (no drag/resize), so it collapses away exactly
//     like the web mobile path, which also never persists. `liveLayouts` is
//     kept and synced directly from `dashboard.layouts` (covers undo/redo,
//     add/remove, auto-arrange, reset, import, dashboard switch — web L162-171).
//     The `onLayoutChange` prop stays in the contract but, like on the web
//     mobile stack, is never invoked.
//   - lucide-react icons GripHorizontal/X/Settings/Maximize2/Minimize2 (web L8-10)
//     -> text glyphs (☰ / ✕ / ⚙ / ⤢ / ⤡); lucide is browser-only.
//   - `@/lib/cn` (web L11) -> StyleSheet style arrays.
//   - `@/components/ui` GlassPanel + Button (web L12) -> the canonical native
//     GlassPanel + inline Pressable icon buttons (the native AppButton is
//     label-only, so the icon-chrome buttons are Pressables, the same choice
//     PageErrorBoundary/EntryDrawer made).
//   - `@/components/feedback` Skeleton + SectionErrorBoundary (web L13) ->
//     reproduced self-contained (`Skeleton`, `NativeSectionErrorBoundary`) per
//     the PageErrorBoundary precedent (those barrels aren't in the native
//     parity manifest). `animate-pulse` becomes a static dimmed box — RN has no
//     CSS keyframes and an Animated.loop would register an open timer under the
//     `--detectOpenHandles` test gate, and these skeletons are Suspense
//     fallbacks that don't render for non-lazy native widget bodies anyway.
//   - `../widgets/registry` getWidgetDef + `../widgets/types` + `../hooks/
//     useDashboardLayout` (web L14-18) -> inlined: the types are reproduced,
//     `GRID_BREAKPOINTS` is reproduced (the RGL-only GRID_COLS/ROW_HEIGHT/
//     GRID_MARGIN are omitted), and `getWidgetDef` keeps the web
//     `WIDGET_REGISTRY.find(w => w.id === id)` shape over an intentionally empty
//     native registry. The web registry maps each widgetId to a React.lazy
//     widget bundle; those widget bodies are their own (later) manifest entries
//     and the registry barrel itself is NOT in the manifest, so at this layer no
//     widget resolves. Rather than the web `if (!def) return null` blank screen,
//     each widget renders an explicit per-widget `WidgetUnavailable` placeholder
//     (conversion-contract rule 7) keeping the full chrome/fullscreen/border/
//     kiosk shell around it — a drop-in for a future registry wiring.
//   - `Suspense` (web L1/121/387) is preserved as a structural pass-through (RN
//     supports it); native widget bodies aren't React.lazy so it never
//     suspends, but it stays ready for a ported body that suspends via a
//     suspense-enabled query.
//
// No DOM / react-grid-layout / Recharts / Leaflet / lucide / old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + GlassPanel, and theme tokens.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── Inlined widget/layout types (web ../widgets/types) ─────────────────────
 * Reproduced self-contained — `../widgets/types` is not a native parity
 * manifest entry. The web `icon: LucideIcon`, `category: WidgetCategory` and
 * `help` fields are browser/unused here and dropped; `component`'s web
 * `LazyExoticComponent<…>` becomes a plain native component type. */
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

interface WidgetDef {
  id: string;
  name: string;
  description: string;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: ComponentType<WidgetProps>;
}

interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

/** react-grid-layout Layout item (position + size in grid units). */
interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  moved?: boolean;
}

/** react-grid-layout Layouts — keyed by breakpoint string. */
interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

interface DashboardSettings {
  refreshInterval: number;
  vehicleId?: number;
  showWidgetBorders: boolean;
  compactMode: boolean;
}

interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  settings?: DashboardSettings;
}

/* ─── Native widget registry (web ../widgets/registry getWidgetDef) ──────────
 * The web registry maps each widgetId to a React.lazy widget bundle. Those
 * widget bodies are their own later manifest entries and the registry barrel is
 * not in the native parity manifest, so the native registry is intentionally
 * empty at this layer. `getWidgetDef` keeps the web lookup shape so a future
 * registry wiring is a drop-in; `renderWidgetBody` falls back to an explicit
 * WidgetUnavailable placeholder (rule 7) instead of the web blank screen. */
const WIDGET_REGISTRY: WidgetDef[] = [];

function getWidgetDef(widgetId: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find(w => w.id === widgetId);
}

/** 'battery-gauge' -> 'Battery Gauge' — display fallback when no def resolves. */
function humanizeWidgetId(widgetId: string): string {
  const label = widgetId
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return label || widgetId;
}

/* ─── Breakpoint constants (web ../hooks/useDashboardLayout L27) ─────────────
 * Only GRID_BREAKPOINTS is reproduced — GRID_COLS / ROW_HEIGHT / GRID_MARGIN
 * were RGL grid props and have no role in the native vertical stack. */
const GRID_BREAKPOINTS = {lg: 1200, md: 996, sm: 768, xs: 480} as const;

/* Text glyphs replacing the lucide-react icons (browser-only). */
const GLYPH = {
  grip: '\u2630', // ☰  (web GripHorizontal — drag handle, inert on touch)
  settings: '\u2699', // ⚙  (web Settings)
  remove: '\u2715', // ✕  (web X)
  maximize: '\u2922', // ⤢  (web Maximize2)
  minimize: '\u2921', // ⤡  (web Minimize2)
  widget: '\u25A6', // ▦  (WidgetUnavailable placeholder mark)
} as const;

/* ─── Skeleton (web @/components/feedback Skeleton) ──────────────────────────
 * A static dimmed box; only ever sized by the caller's style here (web used
 * `h-full` / `h-3/4 w-3/4 rounded-xl`). `animate-pulse` is dropped (see header). */
function Skeleton({
  rounded,
  style,
}: {
  rounded?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <View
      style={[
        styles.skeleton,
        rounded ? styles.skeletonRounded : styles.skeletonSquare,
        style,
      ]}
    />
  );
}

/* ─── NativeSectionErrorBoundary (web @/components/feedback SectionErrorBoundary
 * fallbackTitle path) ───────────────────────────────────────────────────────
 * Wraps a widget so a render failure inside it doesn't blank the whole board.
 * Reproduces the web `fallbackTitle` fallback (AlertTriangle + title +
 * "Other parts of the page should still work.") and the `[ErrorBoundary:{name}]`
 * correlation log. */
interface SectionErrorBoundaryProps {
  children: ReactNode;
  name: string;
  fallbackTitle: string;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
}

class NativeSectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}]`, {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <View accessibilityRole="alert" style={styles.sectionError}>
        <View style={styles.sectionErrorIcon}>
          <AppText style={styles.sectionErrorGlyph} weight="bold">
            !
          </AppText>
        </View>
        <View style={styles.sectionErrorBody}>
          <AppText
            numberOfLines={2}
            style={styles.sectionErrorTitle}
            weight="semibold">
            {this.props.fallbackTitle}
          </AppText>
          <AppText tone="muted" variant="caption">
            Other parts of the page should still work.
          </AppText>
        </View>
      </View>
    );
  }
}

/* ─── WidgetUnavailable (native-safe widget body — rule 7) ───────────────────
 * Shown when no native WidgetDef resolves (the empty native registry). Keeps the
 * board's structure with an explicit, useful unavailable state. */
function WidgetUnavailable({
  name,
  widgetId,
}: {
  name: string;
  widgetId: string;
}): React.ReactElement {
  return (
    <View style={styles.unavailable}>
      <View style={styles.unavailableBadge}>
        <AppText style={styles.unavailableGlyph} weight="bold">
          {GLYPH.widget}
        </AppText>
      </View>
      <AppText
        numberOfLines={1}
        style={styles.unavailableTitle}
        weight="semibold">
        {name}
      </AppText>
      <AppText style={styles.unavailableMsg} tone="muted" variant="caption">
        Widget unavailable in the native parity tree
      </AppText>
      <AppText style={styles.unavailableId} tone="muted" variant="caption">
        {widgetId}
      </AppText>
    </View>
  );
}

/* ─── Widget Chrome (web L38-98 — edit-mode overlay) ─────────────────────────
 * The drag handle is inert on touch (kept as a visual affordance, mirroring the
 * web comment); the settings/remove icon buttons are the functional part. The
 * web `def`/`widget` props are reduced to the resolved display `name` (the web
 * body only read `def.name`). The hover border (web L93-95) is dropped — RN has
 * no hover. */
function WidgetChrome({
  name,
  onRemove,
  onSettings,
}: {
  name: string;
  onRemove: () => void;
  onSettings: () => void;
}): React.ReactElement {
  return (
    <View pointerEvents="box-none" style={styles.chrome}>
      <View style={styles.chromeBar}>
        <View style={styles.chromeBarLeft}>
          <AppText style={styles.chromeGrip}>{GLYPH.grip}</AppText>
          <AppText numberOfLines={1} style={styles.chromeName} variant="caption">
            {name}
          </AppText>
        </View>
        <View style={styles.chromeBarRight}>
          <Pressable
            accessibilityLabel={`Settings for ${name}`}
            accessibilityRole="button"
            hitSlop={6}
            onPress={onSettings}
            style={({pressed}) => [styles.chromeBtn, pressed && styles.chromeBtnPressed]}>
            <AppText style={styles.chromeBtnGlyph}>{GLYPH.settings}</AppText>
          </Pressable>
          <Pressable
            accessibilityLabel={`Remove ${name}`}
            accessibilityRole="button"
            hitSlop={6}
            onPress={onRemove}
            style={({pressed}) => [
              styles.chromeBtn,
              pressed && styles.chromeBtnDangerPressed,
            ]}>
            <AppText style={styles.chromeBtnGlyphDanger}>{GLYPH.remove}</AppText>
          </Pressable>
        </View>
      </View>
      <View pointerEvents="none" style={styles.chromeResizeHint}>
        <AppText style={styles.chromeResizeGlyph}>{GLYPH.maximize}</AppText>
      </View>
    </View>
  );
}

/* ─── Fullscreen Overlay (web L100-131) ──────────────────────────────────────
 * `fixed inset-0 backdrop-blur-xl` -> a native Modal scrim (blur dropped). The
 * web guarded the overlay on `fullscreenDef` being truthy; here `def` may be
 * undefined (empty registry), so the overlay tolerates it and shows the
 * WidgetUnavailable placeholder fullscreen rather than silently doing nothing. */
interface FullscreenOverlayProps {
  widget: WidgetInstance;
  def?: WidgetDef;
  onClose: () => void;
  getWidgetSize: (id: string) => {cols: number; rows: number};
}

function FullscreenOverlay({
  widget,
  def,
  onClose,
  getWidgetSize,
}: FullscreenOverlayProps): React.ReactElement {
  const Component = def?.component;
  const name = def?.name ?? humanizeWidgetId(widget.widgetId);
  const size = getWidgetSize(widget.id);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible>
      <View style={styles.fsRoot}>
        <View style={styles.fsHeader}>
          <AppText
            numberOfLines={1}
            style={styles.fsTitle}
            variant="title"
            weight="semibold">
            {name}
          </AppText>
          <Pressable
            accessibilityLabel="Exit Fullscreen"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({pressed}) => [styles.fsExitBtn, pressed && styles.fsExitBtnPressed]}>
            <AppText style={styles.fsExitGlyph}>{GLYPH.minimize}</AppText>
            <AppText style={styles.fsExitLabel} weight="semibold">
              Exit Fullscreen
            </AppText>
          </Pressable>
        </View>
        <GlassPanel style={styles.fsBody}>
          <Suspense
            fallback={
              <View style={styles.skeletonCenter}>
                <Skeleton style={styles.skeletonFull} />
              </View>
            }>
            {Component ? (
              <Component
                config={widget.config}
                size={{cols: size.cols, rows: Math.max(size.rows, 4)}}
                vehicleId={widget.config?.vehicleId}
              />
            ) : (
              <WidgetUnavailable name={name} widgetId={widget.widgetId} />
            )}
          </Suspense>
        </GlassPanel>
      </View>
    </Modal>
  );
}

/* ─── Props (web DashboardGridProps L21-36) ──────────────────────────────────
 * Reproduced verbatim. `onLayoutChange` and `getWidgetSize` are kept in the
 * contract for call-site parity but, as on the web mobile stack, are not
 * consumed by the native static-stack render (no drag/resize). */
interface DashboardGridProps {
  dashboard: SavedDashboard;
  editMode: boolean;
  onLayoutChange: (layouts: RGLLayouts) => void;
  onRemoveWidget: (instanceId: string) => void;
  onOpenSettings: (instanceId: string) => void;
  getWidgetSize: (instanceId: string) => {cols: number; rows: number};
  /** Dashboard-level vehicle filter (widgets inherit unless they have their own) */
  dashboardVehicleId?: number;
  /** Reduce grid gaps when compact mode is on */
  compactMode?: boolean;
  /** Show a subtle border on each widget */
  showWidgetBorders?: boolean;
  /** Kiosk mode widget opacity boost (0.3–1.0). Increases GlassPanel background. */
  kioskWidgetOpacity?: number;
}

/* ─── Main Grid (web L133-467) ───────────────────────────────────────────── */
export function DashboardGrid({
  dashboard,
  editMode,
  onRemoveWidget,
  onOpenSettings,
  dashboardVehicleId,
  compactMode,
  showWidgetBorders,
  kioskWidgetOpacity,
}: DashboardGridProps): React.ReactElement {
  const [fullscreenWidget, setFullscreenWidget] = useState<string | null>(null);

  // Local layout state. Without RGL drag/resize there is nothing to persist, so
  // liveLayouts simply mirrors dashboard.layouts; the sync still covers external
  // changes (undo/redo, auto-arrange, add/remove, reset, import, switch).
  const [liveLayouts, setLiveLayouts] = useState<RGLLayouts>(dashboard.layouts);

  // RGL v2 measured container width -> the device viewport width on native.
  const {width} = useWindowDimensions();

  useEffect(() => {
    setLiveLayouts(dashboard.layouts);
  }, [dashboard.layouts]);

  // Determine which breakpoint we're rendering for. Mirrors react-grid-layout's
  // `getBreakpointFromWidth`: the largest breakpoint whose threshold is <= the
  // current width, falling back to xs.
  const activeBreakpoint = useMemo(() => {
    const ordered = (
      Object.entries(GRID_BREAKPOINTS) as Array<
        [keyof typeof GRID_BREAKPOINTS, number]
      >
    ).sort((a, b) => b[1] - a[1]);
    for (const [bp, threshold] of ordered) {
      if (width >= threshold) {
        return bp;
      }
    }
    return 'xs' as const;
  }, [width]);

  // Compute widget size from the *active* breakpoint's live layout so widgets
  // receive size.cols matching what the user actually sees (web L250-257).
  const getWidgetSizeLive = useCallback(
    (instanceId: string): {cols: number; rows: number} => {
      const layout = (liveLayouts[activeBreakpoint] ??
        liveLayouts.lg ??
        []) as RGLLayout[];
      const item = layout.find(l => l.i === instanceId);
      if (item) {
        return {cols: item.w, rows: item.h};
      }
      const widget = dashboard.widgets.find(w => w.id === instanceId);
      const def = widget ? getWidgetDef(widget.widgetId) : undefined;
      return def?.defaultSize ?? {cols: 1, rows: 1};
    },
    [liveLayouts, dashboard.widgets, activeBreakpoint],
  );

  // Native always renders the vertical stack (web `isMobileStack`/xs path).
  const isMobileStack = activeBreakpoint === 'xs';

  // Preserve the user's saved mobile order (xs layout y/x) if present, else fall
  // back to widget insertion order (web L280-298).
  const orderedWidgets = useMemo(() => {
    if (!isMobileStack) {
      return dashboard.widgets;
    }
    const xsLayout = (liveLayouts.xs ?? []) as RGLLayout[];
    if (xsLayout.length === 0) {
      return dashboard.widgets;
    }
    const orderMap = new Map<string, number>();
    xsLayout.forEach((l, i) => {
      orderMap.set(l.i, l.y * 10000 + l.x * 100 + i / 1000);
    });
    return [...dashboard.widgets].sort((a, b) => {
      const aOrder = orderMap.get(a.id);
      const bOrder = orderMap.get(b.id);
      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      if (aOrder !== undefined) {
        return -1;
      }
      if (bOrder !== undefined) {
        return 1;
      }
      return 0;
    });
  }, [isMobileStack, dashboard.widgets, liveLayouts.xs]);

  // Kiosk panel background boost (web L300-310). The backdrop-blur has no RN
  // equivalent and is dropped; the background-alpha ramp is preserved.
  const kioskPanelStyle = useMemo<ViewStyle | undefined>(() => {
    if (kioskWidgetOpacity == null) {
      return undefined;
    }
    const alpha = 0.03 + kioskWidgetOpacity * 0.17;
    return {backgroundColor: `rgba(255, 255, 255, ${alpha.toFixed(3)})`};
  }, [kioskWidgetOpacity]);

  const fullscreenInstance = fullscreenWidget
    ? dashboard.widgets.find(w => w.id === fullscreenWidget)
    : null;
  const fullscreenDef = fullscreenInstance
    ? getWidgetDef(fullscreenInstance.widgetId)
    : undefined;

  // Render a single widget's body (web L324-407). `mobile` is always true on the
  // native stack; the param is kept so the helper mirrors the web signature.
  const renderWidgetBody = useCallback(
    (widget: WidgetInstance, mobile: boolean): React.ReactElement => {
      const def = getWidgetDef(widget.widgetId);
      const name = def?.name ?? humanizeWidgetId(widget.widgetId);
      const Component = def?.component;
      const size = getWidgetSizeLive(widget.id);

      return (
        <View
          key={widget.id}
          style={[styles.widgetContainer, mobile && styles.widgetContainerMobile]}>
          {/* Edit-mode chrome — drag handle is inert on touch (settings/remove). */}
          {editMode ? (
            <WidgetChrome
              name={name}
              onRemove={() => onRemoveWidget(widget.id)}
              onSettings={() => onOpenSettings(widget.id)}
            />
          ) : null}

          {/* Fullscreen button (view mode). */}
          {!editMode ? (
            <Pressable
              accessibilityLabel={`Expand ${name}`}
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => setFullscreenWidget(widget.id)}
              style={({pressed}) => [
                styles.expandBtn,
                pressed && styles.expandBtnPressed,
              ]}>
              <AppText style={styles.expandGlyph}>{GLYPH.maximize}</AppText>
            </Pressable>
          ) : null}

          <GlassPanel
            style={[
              styles.panel,
              mobile ? styles.panelMobile : styles.panelDesktop,
              showWidgetBorders && styles.panelBordered,
              kioskPanelStyle,
            ]}>
            <NativeSectionErrorBoundary
              fallbackTitle={`${name} failed to load`}
              name={`widget:${def?.id ?? widget.widgetId}:${widget.id}`}>
              <Suspense
                fallback={
                  <View style={styles.skeletonCenter}>
                    <Skeleton rounded style={styles.skeletonThreeQuarter} />
                  </View>
                }>
                {Component ? (
                  <Component
                    config={widget.config}
                    size={size}
                    vehicleId={widget.config?.vehicleId ?? dashboardVehicleId}
                  />
                ) : (
                  <WidgetUnavailable name={name} widgetId={widget.widgetId} />
                )}
              </Suspense>
            </NativeSectionErrorBoundary>
          </GlassPanel>
        </View>
      );
    },
    [
      editMode,
      getWidgetSizeLive,
      dashboardVehicleId,
      kioskPanelStyle,
      showWidgetBorders,
      onRemoveWidget,
      onOpenSettings,
    ],
  );

  return (
    <>
      <View style={styles.root}>
        <View
          style={[styles.stack, compactMode ? styles.stackCompact : styles.stackNormal]}
          testID="dashboard-mobile-stack">
          {orderedWidgets.map(widget => renderWidgetBody(widget, true))}
        </View>
      </View>

      {/* Fullscreen overlay (web L456-464). */}
      {fullscreenInstance ? (
        <FullscreenOverlay
          def={fullscreenDef}
          getWidgetSize={getWidgetSizeLive}
          onClose={() => setFullscreenWidget(null)}
          widget={fullscreenInstance}
        />
      ) : null}
    </>
  );
}

DashboardGrid.displayName = 'DashboardGrid';

const PANEL_RADIUS = 12; // web rounded-xl
const WIDGET_MIN_HEIGHT = 192; // web min-h-[12rem]

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  // web mobile stack `flex flex-col gap-3` (L428).
  stack: {
    flexDirection: 'column',
  },
  stackNormal: {
    gap: spacing.md, // gap-3 (12)
  },
  // web applies compactMode only to the RGL desktop margin; native maps it to
  // the stack gap to preserve the reduce-gaps intent.
  stackCompact: {
    gap: spacing.sm, // 8
  },
  // web `widget-container relative group` (L334).
  widgetContainer: {
    position: 'relative',
  },
  // web mobile `flex flex-col min-h-[12rem]` (L337).
  widgetContainerMobile: {
    minHeight: WIDGET_MIN_HEIGHT,
  },

  // GlassPanel (web L375-382).
  panel: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: PANEL_RADIUS,
  },
  panelMobile: {
    flex: 1,
    minHeight: 0,
  },
  panelDesktop: {
    height: '100%',
  },
  // web showWidgetBorders -> border border-[var(--border-subtle)] (L379).
  panelBordered: {
    borderColor: colors.borderAccent,
  },

  // Skeleton (web Skeleton — static dimmed box).
  skeleton: {
    backgroundColor: colors.surfaceRaised,
  },
  skeletonSquare: {
    borderRadius: 6,
  },
  skeletonRounded: {
    borderRadius: PANEL_RADIUS,
  },
  // web `h-full flex items-center justify-center` wrapper (L389).
  skeletonCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // web `h-full` (L121).
  skeletonFull: {
    alignSelf: 'stretch',
    flex: 1,
  },
  // web `h-3/4 w-3/4 rounded-xl` (L390).
  skeletonThreeQuarter: {
    width: '75%',
    height: '75%',
  },

  // Edit-mode chrome (web L38-98).
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  // web drag handle bar `h-8 from-black/60 px-3` (L52-57).
  chromeBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderTopLeftRadius: PANEL_RADIUS,
    borderTopRightRadius: PANEL_RADIUS,
  },
  chromeBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  chromeGrip: {
    color: colors.textMuted,
    fontSize: 13,
  },
  chromeName: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  chromeBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chromeBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  chromeBtnPressed: {
    backgroundColor: colors.surfaceHover,
  },
  chromeBtnDangerPressed: {
    backgroundColor: colors.dangerSurface,
  },
  chromeBtnGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  chromeBtnGlyphDanger: {
    color: colors.danger,
    fontSize: 13,
  },
  // web resize indicator bottom-1 right-1 (L88-91).
  chromeResizeHint: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
  },
  chromeResizeGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    opacity: 0.5,
  },

  // Fullscreen button view mode (web L352-365).
  expandBtn: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 10,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  expandBtnPressed: {
    backgroundColor: colors.surfaceHover,
  },
  expandGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },

  // NativeSectionErrorBoundary fallback (web SectionErrorBoundary L46-57).
  sectionError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    padding: spacing.md,
  },
  sectionErrorIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  sectionErrorGlyph: {
    color: colors.danger,
    fontSize: 16,
  },
  sectionErrorBody: {
    flex: 1,
    minWidth: 0,
  },
  sectionErrorTitle: {
    color: colors.textSecondary,
  },

  // WidgetUnavailable placeholder (native-safe, rule 7).
  unavailable: {
    flex: 1,
    minHeight: WIDGET_MIN_HEIGHT - 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  unavailableBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.xs,
  },
  unavailableGlyph: {
    color: colors.textSecondary,
    fontSize: 20,
  },
  unavailableTitle: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  unavailableMsg: {
    textAlign: 'center',
  },
  unavailableId: {
    color: colors.textMuted,
    textAlign: 'center',
  },

  // Fullscreen overlay (web L112-129).
  fsRoot: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 13, 0.94)',
    padding: spacing.lg,
  },
  fsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  fsTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  fsExitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  fsExitBtnPressed: {
    backgroundColor: colors.surfaceHover,
  },
  fsExitGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  fsExitLabel: {
    color: colors.textSecondary,
  },
  fsBody: {
    flex: 1,
    overflow: 'hidden',
  },
});
