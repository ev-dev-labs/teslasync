// DashboardPage — native parity port of
// web/src/features/dashboard/pages/DashboardPage.tsx.
//
// The Command Center: the app's home surface. It orchestrates a customizable,
// multi-layout widget dashboard (DashboardGrid), a layout switcher + manager,
// a widget picker / catalogue, a template gallery, import/export, per-dashboard
// settings, kiosk mode, an onboarding/empty state, a first-run theme prompt, a
// soft "customize" hint, live + auth banners, and a header action bar with
// undo/redo + refresh. Every state name, API path ('/vehicles', '/alerts?limit=10',
// '/auth/status', '/vehicles/sync', '/settings/dashboard-layouts'), i18n key +
// English fallback, derived value and handler is preserved verbatim from the web
// source; all 745 source lines are mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react-router-dom Link (web L4) -> a native LinkText Pressable (no router
//     navigation target in this single-file slice; press is a documented no-op
//     placeholder preserving the affordance + label).
//   - react-i18next useTranslation('dashboard') | useTranslation() (web L5) ->
//     native-safe t(key, fallback, options?) shim with {{var}} interpolation; the
//     namespace arg is accepted and ignored (no i18n runtime in RN).
//   - @/api/client request (web L6) -> native ../../../api/client request (same
//     signature + auto /api/v1 prefix).
//   - @/api/hooks/useSettings useAuthStatus + the dashboard-layouts query/mutation
//     (web L7, used transitively) -> native ../../../api/hooks/useSettings
//     useAuthStatus + useDashboardLayouts/useSaveDashboardLayouts (identical paths).
//   - @/api/hooks/useVehicles useSyncVehicles (web L8) -> native
//     ../../../api/hooks/useVehicles useSyncVehicles (/vehicles/sync POST).
//   - @/components/layout PageContainer (web L9) -> inline RN PageContainer
//     (single ScrollView + RefreshControl-free header; the page owns no pull-to-
//     refresh — refresh is an explicit header button as on the web).
//   - @/components/ui GlassPanel/Button/PrintButton (web L10-12) -> the canonical
//     native GlassPanel + inline Pressable buttons; PrintButton -> a native-safe
//     no-op Pressable (browser window.print is unavailable; rule 7).
//   - @/components/motion FadeIn (web L13) -> passthrough View (no framer-motion).
//   - @/components/feedback AlertBanner/LiveStaleDataBanner/Skeleton (web L14, L16)
//     -> inline RN AlertBanner, a native-safe LiveStaleDataBanner (renders null —
//     no live SSE pipe in this layer), and an RN Skeleton box.
//   - @/components/data-display LiveIndicator/DataFreshnessAuto (web L15) -> inline
//     RN LiveIndicator (static compact pill) + DataFreshnessAuto (reads the
//     query's dataUpdatedAt; no useLiveConnection SSE).
//   - @/hooks useRealtimeEvents/usePageTitle (web L17-18) -> native-safe shims:
//     useRealtimeEvents is a no-op (cross-tab SSE invalidation is browser-only;
//     RN relies on react-query refetch), usePageTitle is a no-op (no document.title).
//   - @/components/ui/ThemeProvider useTheme (web L19) -> a native-safe useTheme
//     returning the default themeId 'neon-cyan' (no theme provider wired in this
//     slice; the first-run banner's default-theme branch is preserved).
//   - lucide-react Palette + @/lib/icons Icons (web L20, L44) -> text/emoji glyphs.
//   - ../components DashboardGrid/LayoutSwitcher/WidgetCatalogueDialog (web L21,25,33)
//     -> imported from their canonical converted native files (../components/*).
//   - the 11 remaining ../components (WidgetPicker, WidgetSettingsModal,
//     LayoutManager, TemplateGallery, ExportModal, ImportPreviewModal,
//     DashboardSettingsModal, KioskOverlay, KioskSettingsModal, AddWidgetButton,
//     RecentlyViewedWidget — web L22-24,26-32,34) -> inline native-safe equivalents
//     preserving each prop contract + primary behaviour; their full surfaces remain
//     owned by their own conversion turns. Browser-only bits (file download,
//     localStorage history, clipboard) become native-safe (Share / TextInput / no-op).
//   - ../hooks useDashboardLayout/useLayoutKeyboard/useKioskMode + validateImport
//     fromUrlSafeBase64 (web L35-38) -> inline native-safe ports: the layout engine
//     keeps the full return contract (in-memory + backend sync; localStorage /
//     BroadcastChannel / react-grid-layout verticalCompactor are browser-only and
//     replaced by in-memory state + a no-op compactor); useLayoutKeyboard is a no-op
//     (hardware-keyboard shortcuts are browser-only); useKioskMode keeps config +
//     rotation (fullscreen / cursor-hide / screen-dim / URL-param auto-kiosk are
//     browser-only). fromUrlSafeBase64 is ported native-safe but unreachable (no URL
//     hash on native).
//   - ../widgets/registry getWidgetDef + ../widgets/types (web L39, L41-42) ->
//     inlined: types reproduced; getWidgetDef is id-permissive (the def-body
//     registry is owned by each widget's own turn, per DashboardGrid) returning
//     default 1x1 sizing.
//   - @/features/onboarding/checklist markCustomizeDashboardCompleted (web L40) ->
//     native-safe no-op (localStorage-backed onboarding state).
//   - createPortal kiosk root to document.body (web L2, L644-678) -> a native
//     full-screen <Modal> (no DOM portal).
//   - window.* (location.hash import, dashboard:* CustomEvent bridge, confirm,
//     dispatchEvent) (web L105, L261-302) -> native-safe no-ops / Alert, documented.
//
// No DOM / react-router / react-i18next / framer-motion / lucide / recharts /
// leaflet / old web-UI import reaches the native output — only react, react-native
// primitives, @tanstack/react-query, the canonical AppText/GlassPanel + theme
// tokens, the native client/settings/vehicles hooks, and the three converted
// dashboard components.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {useQuery, useQueryClient, type UseQueryResult} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {
  useAuthStatus,
  useDashboardLayouts,
  useSaveDashboardLayouts,
  type DashboardLayoutsPayload,
} from '../../../api/hooks/useSettings';
import {useSyncVehicles} from '../../../api/hooks/useVehicles';
import type {Alert as ApiAlert, Vehicle} from '../../../api/types';
import {DashboardGrid} from '../components/DashboardGrid';
import {LayoutSwitcher} from '../components/LayoutSwitcher';
import {WidgetCatalogueDialog} from '../components/WidgetCatalogueDialog';

// ===========================================================================
// Native-safe i18n shim (web react-i18next useTranslation)
// ===========================================================================

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

// The web hook accepts an optional namespace ('dashboard'); native ignores it.
function useTranslation(_ns?: string): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
  return {t};
}

// ===========================================================================
// Native-safe app-hook shims (web @/hooks/*, @/components/ui/ThemeProvider)
// ===========================================================================

// web @/hooks/usePageTitle — RN has no document.title; no-op (dependency mirrored).
function usePageTitle(title: string): void {
  useEffect(() => {
    // No browser tab to title on native.
  }, [title]);
}

// web @/components/ui/ThemeProvider useTheme — no theme provider in this slice.
// The default theme id matches the web seed so the first-run banner's
// default-theme branch (themeId === 'neon-cyan') is preserved.
function useTheme(): {themeId: string} {
  return {themeId: 'neon-cyan'};
}

interface RealtimeEventHandlers {
  onVehicleUpdate?: () => void;
  onFallbackToPolling?: () => void;
}

// web @/hooks/useRealtimeEvents — cross-tab SSE cache invalidation is browser-only.
// Native relies on react-query refetch; the handlers are accepted and ignored.
function useRealtimeEvents(_handlers: RealtimeEventHandlers): void {
  useEffect(() => {
    // No SSE EventSource wired in this layer.
  }, []);
}

// web @/features/onboarding/checklist — localStorage-backed; native-safe no-op.
function markCustomizeDashboardCompleted(): void {
  // Onboarding checklist persistence is browser-only.
}

// ===========================================================================
// Native-safe storage shim (web localStorage)
//
// The web layout/kiosk engines persist to localStorage. RN has no synchronous
// localStorage and AsyncStorage isn't on the native dependency manifest, so
// this is an in-memory map: it keeps the read/write call sites verbatim while
// being session-scoped (documented). Backend sync (below) is the durable layer.
// ===========================================================================

const memoryStore = new Map<string, string>();
const safeStorage = {
  getItem(key: string): string | null {
    return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    memoryStore.set(key, value);
  },
  removeItem(key: string): void {
    memoryStore.delete(key);
  },
};

// ===========================================================================
// Native-safe base64 (web validateImport fromUrlSafeBase64)
//
// Ported for source-coverage parity; only the URL-hash import effect calls it,
// and that effect is a native no-op (no window.location.hash), so it never runs.
// ===========================================================================

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function fromUrlSafeBase64(encoded: string): string {
  /* eslint-disable no-bitwise -- base64 + UTF-8 decoding is inherently bitwise */
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of padded) {
    if (ch === '=') {
      break;
    }
    const idx = B64_ALPHABET.indexOf(ch);
    if (idx === -1) {
      continue;
    }
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // UTF-8 decode.
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      result += String.fromCharCode(b0);
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      const b1 = bytes[i++] ?? 0;
      result += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = bytes[i++] ?? 0;
      const b2 = bytes[i++] ?? 0;
      result += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f),
      );
    } else {
      const b1 = bytes[i++] ?? 0;
      const b2 = bytes[i++] ?? 0;
      const b3 = bytes[i++] ?? 0;
      const code =
        ((b0 & 0x07) << 18) |
        ((b1 & 0x3f) << 12) |
        ((b2 & 0x3f) << 6) |
        (b3 & 0x3f);
      const adjusted = code - 0x10000;
      result += String.fromCharCode(
        0xd800 + (adjusted >> 10),
        0xdc00 + (adjusted & 0x3ff),
      );
    }
  }
  return result;
  /* eslint-enable no-bitwise */
}

// ===========================================================================
// Inlined widget/layout types (web ../widgets/types)
//
// Reproduced self-contained. The web `icon: LucideIcon`, `category` and `help`
// fields are browser/unused here and dropped; `component`'s web LazyExotic type
// is omitted (the native registry resolves no bodies at this layer).
// ===========================================================================

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

interface WidgetDef {
  id: string;
  name: string;
  description: string;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
}

interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

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

interface LegacyDashboardLayout {
  id: string;
  name: string;
  widgets: {
    id: string;
    widgetId: string;
    position: number;
    size: WidgetSize;
    config?: Record<string, unknown>;
  }[];
  createdAt: string;
  updatedAt: string;
}

// ===========================================================================
// Native widget registry (web ../widgets/registry getWidgetDef)
//
// The web registry maps each widgetId to a React.lazy widget bundle (defs with
// real min/max sizes). Those bodies are each their own conversion turn and the
// registry barrel is not a native parity manifest entry, so the native registry
// resolves no bodies. To keep add/preset/import/duplicate functional, the
// registry is id-permissive: getWidgetDef returns a default 1x1 def for any
// non-empty id (DashboardGrid renders the per-widget unavailable placeholder),
// and isKnownWidgetId accepts any non-empty id (the web WIDGET_REGISTRY
// membership filter).
// ===========================================================================

function getWidgetDef(widgetId: string): WidgetDef | undefined {
  if (!widgetId) {
    return undefined;
  }
  return {
    id: widgetId,
    name: widgetId,
    description: '',
    defaultSize: {cols: 1, rows: 1},
    minSize: {cols: 1, rows: 1},
    maxSize: {cols: 4, rows: 20},
  };
}

function isKnownWidgetId(widgetId: string): boolean {
  return typeof widgetId === 'string' && widgetId.length > 0;
}

// ===========================================================================
// Layout engine constants + helpers (web ../hooks/useDashboardLayout)
// ===========================================================================

const GRID_COLS = {lg: 4, md: 3, sm: 2, xs: 1} as const;

const DASHBOARDS_KEY = 'teslasync-dashboards';
const ACTIVE_KEY = 'teslasync-active-dashboard';
const LEGACY_KEY = 'teslasync-dashboard-layout';

interface DashboardSnapshot {
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
}

let nextId = Date.now();
function generateId(): string {
  return `w-${++nextId}`;
}

function clampMinMax(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildLayoutItem(
  widget: WidgetInstance,
  cols: number,
  x: number,
  y: number,
): RGLLayout {
  const def = getWidgetDef(widget.widgetId);
  const defaultW = def?.defaultSize.cols ?? 1;
  const defaultH = def?.defaultSize.rows ?? 1;
  const minW = Math.min(def?.minSize.cols ?? 1, cols);
  const minH = def?.minSize.rows ?? 1;
  const maxW = Math.min(def?.maxSize.cols ?? cols, cols);
  const maxH = def?.maxSize.rows ?? 20;
  return {
    i: widget.id,
    x: x % cols,
    y,
    w: clampMinMax(Math.min(defaultW, cols), minW, maxW),
    h: clampMinMax(defaultH, minH, maxH),
    minW,
    minH,
    maxW,
    maxH,
  };
}

function buildDefaultLayouts(widgets: WidgetInstance[]): RGLLayouts {
  const layouts: RGLLayouts = {};
  for (const [bp, cols] of Object.entries(GRID_COLS)) {
    let x = 0;
    let y = 0;
    let rowMaxH = 0;
    const items: RGLLayout[] = [];
    for (const widget of widgets) {
      const item = buildLayoutItem(widget, cols, x, y);
      if (x + item.w > cols) {
        x = 0;
        y += rowMaxH;
        rowMaxH = 0;
        item.x = 0;
        item.y = y;
      }
      items.push(item);
      x += item.w;
      rowMaxH = Math.max(rowMaxH, item.h);
    }
    layouts[bp] = items;
  }
  return layouts;
}

function sanitizeLayouts(layouts: RGLLayouts): RGLLayouts {
  const result: RGLLayouts = {};
  for (const [bp, items] of Object.entries(layouts)) {
    result[bp] = items.map(item => ({
      ...item,
      w: Math.max(Number.isFinite(item.w) ? item.w : 1, 1),
      h: Math.max(Number.isFinite(item.h) ? item.h : 1, 1),
      x: Math.max(Number.isFinite(item.x) ? item.x : 0, 0),
      y: Math.max(Number.isFinite(item.y) ? item.y : 0, 0),
    }));
  }
  return result;
}

// web compactLayouts used react-grid-layout's verticalCompactor (browser-only).
// Native renders a static vertical stack (no RGL positioning), so compaction is
// a no-op pass-through — the widget/layout bookkeeping is preserved for undo/redo
// and getWidgetSize while DashboardGrid owns the on-screen stacking.
function compactLayouts(layouts: RGLLayouts): RGLLayouts {
  return layouts;
}

function reconcileLayouts(
  layouts: RGLLayouts,
  widgets: WidgetInstance[],
): RGLLayouts {
  const widgetIds = new Set(widgets.map(w => w.id));
  const result: RGLLayouts = {};
  for (const [bp, cols] of Object.entries(GRID_COLS)) {
    const existing: RGLLayout[] = layouts[bp] ?? [];
    const existingMap = new Map<string, RGLLayout>(
      existing.map(item => [item.i, item]),
    );
    const items: RGLLayout[] = [];
    for (const widget of widgets) {
      const def = getWidgetDef(widget.widgetId);
      const minW = Math.min(def?.minSize.cols ?? 1, cols);
      const minH = def?.minSize.rows ?? 1;
      const maxW = Math.min(def?.maxSize.cols ?? cols, cols);
      const maxH = def?.maxSize.rows ?? 20;
      const prev = existingMap.get(widget.id);
      if (prev) {
        items.push({
          ...prev,
          w: clampMinMax(prev.w, minW, maxW),
          h: clampMinMax(prev.h, minH, maxH),
          minW,
          minH,
          maxW,
          maxH,
        });
      } else {
        items.push(buildLayoutItem(widget, cols, 0, Infinity));
      }
    }
    result[bp] = items.filter(item => widgetIds.has(item.i));
  }
  return compactLayouts(result);
}

function makePreset(
  id: string,
  name: string,
  widgetSpecs: {widgetId: string; config?: WidgetConfig}[],
  isDefault?: boolean,
): SavedDashboard {
  const widgets: WidgetInstance[] = widgetSpecs.map((spec, i) => ({
    id: `${id}-${i + 1}`,
    widgetId: spec.widgetId,
    config: spec.config,
  }));
  return {
    id,
    name,
    widgets,
    layouts: buildDefaultLayouts(widgets),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDefault,
  };
}

const DEFAULT_DASHBOARD = makePreset(
  'default',
  'Default',
  [
    {widgetId: 'onboarding-checklist'},
    {widgetId: 'vehicle-hero'},
    {widgetId: 'battery-gauge'},
    {widgetId: 'climate-status'},
    {widgetId: 'recent-drives'},
    {widgetId: 'charge-status'},
    {widgetId: 'security-status'},
    {widgetId: 'quick-nav'},
  ],
  true,
);

const DASHBOARD_PRESETS: SavedDashboard[] = [
  DEFAULT_DASHBOARD,
  makePreset('commuter', 'Daily Commuter', [
    {widgetId: 'battery-gauge'},
    {widgetId: 'range-estimate'},
    {widgetId: 'charge-status'},
    {widgetId: 'climate-status'},
    {widgetId: 'security-status'},
    {widgetId: 'location-map'},
    {widgetId: 'quick-nav'},
  ]),
  makePreset('fleet_manager', 'Fleet Manager', [
    {widgetId: 'fleet-stats'},
    {widgetId: 'recent-drives'},
    {widgetId: 'charge-history'},
    {widgetId: 'drive-score'},
    {widgetId: 'vehicle-hero'},
    {widgetId: 'quick-nav'},
  ]),
  makePreset('data_nerd', 'Data Nerd', [
    {widgetId: 'live-signals'},
    {widgetId: 'energy-flow'},
    {widgetId: 'vehicle-twin'},
    {widgetId: 'battery-gauge'},
    {widgetId: 'drive-score'},
  ]),
  makePreset('charging_focus', 'Charging Hub', [
    {widgetId: 'charge-status-live'},
    {widgetId: 'battery-radial-gauge'},
    {widgetId: 'charge-session-chart'},
    {widgetId: 'charge-cost-tracker'},
    {widgetId: 'charging-schedule'},
    {widgetId: 'range-bar'},
    {widgetId: 'energy-flow-animated'},
  ]),
  makePreset('security_monitor', 'Security Monitor', [
    {widgetId: 'door-window-status'},
    {widgetId: 'sentry-event-log'},
    {widgetId: 'location-map'},
    {widgetId: 'vehicle-hero-card'},
    {widgetId: 'alert-feed'},
    {widgetId: 'command-quick-actions'},
  ]),
  makePreset('road_trip', 'Road Trip', [
    {widgetId: 'battery-radial-gauge'},
    {widgetId: 'range-bar'},
    {widgetId: 'location-map'},
    {widgetId: 'weather-at-car'},
    {widgetId: 'tire-pressure-visual'},
    {widgetId: 'climate-control-panel'},
    {widgetId: 'recent-drives-list'},
    {widgetId: 'drive-efficiency-chart'},
  ]),
  makePreset('performance', 'Performance', [
    {widgetId: 'drive-score-gauge'},
    {widgetId: 'speed-heatmap'},
    {widgetId: 'drive-efficiency-chart'},
    {widgetId: 'battery-degradation-trend'},
    {widgetId: 'energy-flow-animated'},
    {widgetId: 'live-signal-sparklines'},
  ]),
  makePreset('kiosk_wall', 'Wall Display', [
    {widgetId: 'vehicle-hero'},
    {widgetId: 'battery-radial-gauge'},
    {widgetId: 'charge-status-live'},
    {widgetId: 'location-map'},
    {widgetId: 'weather-at-car'},
    {widgetId: 'uptime-monitor'},
  ]),
  makePreset('minimal', 'Minimal', [
    {widgetId: 'battery-radial-gauge'},
    {widgetId: 'charge-status'},
    {widgetId: 'climate-status'},
    {widgetId: 'quick-nav'},
  ]),
];

function migrateLegacy(legacy: LegacyDashboardLayout): SavedDashboard {
  const widgets: WidgetInstance[] = legacy.widgets
    .filter(w => isKnownWidgetId(w.widgetId))
    .map(w => ({id: w.id, widgetId: w.widgetId, config: w.config}));
  return {
    id: legacy.id || 'migrated',
    name: legacy.name || 'My Dashboard',
    widgets,
    layouts: buildDefaultLayouts(widgets),
    createdAt: legacy.createdAt,
    updatedAt: new Date().toISOString(),
    isDefault: true,
  };
}

function loadDashboards(): SavedDashboard[] {
  try {
    const stored = safeStorage.getItem(DASHBOARDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as SavedDashboard[];
      return parsed.map(d => ({
        ...d,
        widgets: d.widgets.filter(w => isKnownWidgetId(w.widgetId)),
        layouts: sanitizeLayouts(
          reconcileLayouts(
            d.layouts ?? {},
            d.widgets.filter(w => isKnownWidgetId(w.widgetId)),
          ),
        ),
      }));
    }
    const legacy = safeStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as LegacyDashboardLayout;
      const migrated = migrateLegacy(parsed);
      const dashboards = [migrated];
      safeStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dashboards));
      safeStorage.removeItem(LEGACY_KEY);
      return dashboards;
    }
  } catch {
    // Fall through to default.
  }
  return [{...DEFAULT_DASHBOARD}];
}

function loadActiveId(): string {
  return safeStorage.getItem(ACTIVE_KEY) ?? 'default';
}

function isLocalStorageDefaultOnly(): boolean {
  try {
    const raw = safeStorage.getItem(DASHBOARDS_KEY);
    if (!raw) {
      return true;
    }
    const parsed = JSON.parse(raw) as SavedDashboard[];
    return parsed.length <= 1 && parsed[0]?.id === 'default';
  } catch {
    return true;
  }
}

// ===========================================================================
// useUndoRedo (web ../hooks/useUndoRedo) — ported verbatim
// ===========================================================================

interface UndoRedoState<T> {
  current: T;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  set: (value: T) => void;
  undo: () => T | undefined;
  redo: () => T | undefined;
  reset: (value: T) => void;
}

const MAX_HISTORY = 50;

function useUndoRedo<T>(initialValue: T): UndoRedoState<T> {
  const [, forceRender] = useState(0);
  const currentRef = useRef<T>(initialValue);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);

  const set = useCallback((value: T) => {
    undoStack.current.push(currentRef.current);
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift();
    }
    redoStack.current = [];
    currentRef.current = value;
    forceRender(v => v + 1);
  }, []);

  const undo = useCallback((): T | undefined => {
    const previous = undoStack.current.pop();
    if (previous === undefined) {
      return undefined;
    }
    redoStack.current.push(currentRef.current);
    currentRef.current = previous;
    forceRender(v => v + 1);
    return previous;
  }, []);

  const redo = useCallback((): T | undefined => {
    const next = redoStack.current.pop();
    if (next === undefined) {
      return undefined;
    }
    undoStack.current.push(currentRef.current);
    currentRef.current = next;
    forceRender(v => v + 1);
    return next;
  }, []);

  const reset = useCallback((value: T) => {
    undoStack.current = [];
    redoStack.current = [];
    currentRef.current = value;
    forceRender(v => v + 1);
  }, []);

  return {
    current: currentRef.current,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undoCount: undoStack.current.length,
    set,
    undo,
    redo,
    reset,
  };
}

// ===========================================================================
// useDashboardLayout (web ../hooks/useDashboardLayout)
//
// Native-safe in-memory engine + backend sync. The full return contract, state
// names and behaviours are preserved. localStorage -> safeStorage (in-memory);
// the BroadcastChannel cross-tab sync (web broadcast/subscribe) is dropped (no
// peer tabs on native); react-grid-layout verticalCompactor -> no-op compactor.
// Backend hydrate (useDashboardLayouts) + debounced save (useSaveDashboardLayouts)
// are wired to the real /settings/dashboard-layouts endpoint.
// ===========================================================================

function useDashboardLayout() {
  const [dashboards, setDashboards] = useState<SavedDashboard[]>(loadDashboards);
  const [activeId, setActiveId] = useState<string>(loadActiveId);
  const [editMode, setEditMode] = useState(false);
  const [hydratedFromBackend, setHydratedFromBackend] = useState(false);

  const {data: backendLayouts} = useDashboardLayouts();
  const saveMutation = useSaveDashboardLayouts();

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dirty, setDirty] = useState(false);
  const syncToBackend = useCallback(
    (dbs: SavedDashboard[], active: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      setDirty(true);
      debounceTimerRef.current = setTimeout(() => {
        const payload: DashboardLayoutsPayload = {
          dashboards: dbs,
          active_id: active,
        };
        saveMutation.mutate(payload, {
          onSuccess: () => setDirty(false),
        });
      }, 2000);
    },
    [saveMutation],
  );

  useEffect(() => {
    if (hydratedFromBackend || !backendLayouts) {
      return;
    }
    setHydratedFromBackend(true);
    const hasBackendData =
      Array.isArray(backendLayouts.dashboards) &&
      backendLayouts.dashboards.length > 0;
    if (!hasBackendData) {
      return;
    }
    if (!isLocalStorageDefaultOnly()) {
      return;
    }
    const restored = backendLayouts.dashboards as SavedDashboard[];
    const restoredActiveId = backendLayouts.active_id || 'default';
    const reconciled = restored.map(d => {
      const validWidgets = (d.widgets ?? []).filter(w =>
        isKnownWidgetId(w.widgetId),
      );
      return {
        ...d,
        widgets: validWidgets,
        layouts: sanitizeLayouts(reconcileLayouts(d.layouts ?? {}, validWidgets)),
      };
    });
    if (reconciled.length === 0) {
      return;
    }
    setDashboards(reconciled);
    safeStorage.setItem(DASHBOARDS_KEY, JSON.stringify(reconciled));
    const finalActiveId = reconciled.some(d => d.id === restoredActiveId)
      ? restoredActiveId
      : reconciled[0].id;
    setActiveId(finalActiveId);
    safeStorage.setItem(ACTIVE_KEY, finalActiveId);
  }, [backendLayouts, hydratedFromBackend]);

  const activeDashboard = useMemo(() => {
    return (
      dashboards.find(d => d.id === activeId) ??
      dashboards[0] ??
      DEFAULT_DASHBOARD
    );
  }, [dashboards, activeId]);

  const activeDashRef = useRef(activeDashboard);
  activeDashRef.current = activeDashboard;
  const dashboardsRef = useRef(dashboards);
  dashboardsRef.current = dashboards;

  const {
    canUndo,
    canRedo,
    undoCount,
    set: pushSnapshot,
    undo: undoSnapshot,
    redo: redoSnapshot,
    reset: resetSnapshot,
  } = useUndoRedo<DashboardSnapshot>({
    widgets: activeDashboard.widgets,
    layouts: activeDashboard.layouts,
  });

  const persist = useCallback(
    (dbs: SavedDashboard[], active?: string) => {
      setDashboards(dbs);
      safeStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dbs));
      const resolvedActive = active !== undefined ? active : activeId;
      if (active !== undefined) {
        setActiveId(active);
        safeStorage.setItem(ACTIVE_KEY, active);
      }
      syncToBackend(dbs, resolvedActive);
    },
    [activeId, syncToBackend],
  );

  const updateActive = useCallback(
    (updater: (d: SavedDashboard) => SavedDashboard) => {
      setDashboards(prev => {
        const updated = prev.map(d =>
          d.id === activeId
            ? updater({...d, updatedAt: new Date().toISOString()})
            : d,
        );
        safeStorage.setItem(DASHBOARDS_KEY, JSON.stringify(updated));
        syncToBackend(updated, activeId);
        return updated;
      });
    },
    [activeId, syncToBackend],
  );

  const updateLayouts = useCallback(
    (layouts: RGLLayouts) => {
      pushSnapshot({widgets: activeDashRef.current.widgets, layouts});
      updateActive(d => ({...d, layouts}));
    },
    [updateActive, pushSnapshot],
  );

  const addWidgets = useCallback(
    (widgetIds: string[]) => {
      const current = activeDashRef.current;
      const existingWidgetIds = new Set(current.widgets.map(w => w.widgetId));
      const newWidgets: WidgetInstance[] = [];
      for (const widgetId of widgetIds) {
        if (existingWidgetIds.has(widgetId) || !isKnownWidgetId(widgetId)) {
          continue;
        }
        existingWidgetIds.add(widgetId);
        newWidgets.push({id: generateId(), widgetId});
      }
      if (newWidgets.length === 0) {
        return;
      }
      const widgets = [...current.widgets, ...newWidgets];
      const layouts = reconcileLayouts(current.layouts, widgets);
      pushSnapshot({widgets, layouts});
      updateActive(d => ({...d, widgets, layouts}));
    },
    [updateActive, pushSnapshot],
  );

  const addWidget = useCallback(
    (widgetId: string) => addWidgets([widgetId]),
    [addWidgets],
  );

  const removeWidget = useCallback(
    (instanceId: string) => {
      const current = activeDashRef.current;
      const widgets = current.widgets.filter(w => w.id !== instanceId);
      const layouts = reconcileLayouts(current.layouts, widgets);
      pushSnapshot({widgets, layouts});
      updateActive(d => ({...d, widgets, layouts}));
    },
    [updateActive, pushSnapshot],
  );

  const updateWidgetConfig = useCallback(
    (instanceId: string, config: WidgetConfig) => {
      updateActive(d => ({
        ...d,
        widgets: d.widgets.map(w =>
          w.id === instanceId ? {...w, config} : w,
        ),
      }));
    },
    [updateActive],
  );

  const switchDashboard = useCallback(
    (id: string) => {
      setActiveId(id);
      safeStorage.setItem(ACTIVE_KEY, id);
      const dash = dashboardsRef.current.find(d => d.id === id);
      if (dash) {
        resetSnapshot({widgets: dash.widgets, layouts: dash.layouts});
      }
    },
    [resetSnapshot],
  );

  const createDashboard = useCallback(
    (name: string, fromPreset?: SavedDashboard) => {
      const id = `custom-${Date.now()}`;
      const base = fromPreset ?? DEFAULT_DASHBOARD;
      const newDash: SavedDashboard = {
        ...base,
        id,
        name,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persist([...dashboards, newDash], id);
      resetSnapshot({widgets: newDash.widgets, layouts: newDash.layouts});
      return id;
    },
    [dashboards, persist, resetSnapshot],
  );

  const renameDashboard = useCallback(
    (id: string, name: string) => {
      persist(
        dashboards.map(d =>
          d.id === id ? {...d, name, updatedAt: new Date().toISOString()} : d,
        ),
      );
    },
    [dashboards, persist],
  );

  const deleteDashboard = useCallback(
    (id: string) => {
      const target = dashboards.find(d => d.id === id);
      if (!target || target.isDefault) {
        return;
      }
      const remaining = dashboards.filter(d => d.id !== id);
      if (remaining.length === 0) {
        return;
      }
      const nextActive =
        id === activeId
          ? remaining.find(d => d.isDefault)?.id ?? remaining[0].id
          : activeId;
      persist(remaining, nextActive);
      if (id === activeId) {
        const nextDash = remaining.find(d => d.id === nextActive);
        if (nextDash) {
          resetSnapshot({
            widgets: nextDash.widgets,
            layouts: nextDash.layouts,
          });
        }
      }
    },
    [dashboards, activeId, persist, resetSnapshot],
  );

  const reorderDashboards = useCallback(
    (fromIndex: number, toIndex: number) => {
      setDashboards(prev => {
        const result = [...prev];
        const [moved] = result.splice(fromIndex, 1);
        result.splice(toIndex, 0, moved);
        safeStorage.setItem(DASHBOARDS_KEY, JSON.stringify(result));
        syncToBackend(result, activeId);
        return result;
      });
    },
    [activeId, syncToBackend],
  );

  const duplicateDashboard = useCallback(
    (id: string) => {
      const source = dashboards.find(d => d.id === id);
      if (!source) {
        return;
      }
      const newId = `dup-${Date.now()}`;
      const idMap = new Map<string, string>();
      const widgets = source.widgets.map(w => {
        const newWidgetId = generateId();
        idMap.set(w.id, newWidgetId);
        return {...w, id: newWidgetId};
      });
      const remappedLayouts: RGLLayouts = {};
      for (const [bp, items] of Object.entries(source.layouts)) {
        remappedLayouts[bp] = items.map(item => ({
          ...item,
          i: idMap.get(item.i) ?? item.i,
        }));
      }
      const layouts = reconcileLayouts(remappedLayouts, widgets);
      const duplicate: SavedDashboard = {
        ...source,
        id: newId,
        name: `${source.name} (Copy)`,
        icon: source.icon,
        isDefault: false,
        widgets,
        layouts,
        settings: source.settings ? {...source.settings} : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persist([...dashboards, duplicate], newId);
      resetSnapshot({widgets: duplicate.widgets, layouts: duplicate.layouts});
    },
    [dashboards, persist, resetSnapshot],
  );

  const updateDashboardSettings = useCallback(
    (id: string, settings: DashboardSettings) => {
      persist(
        dashboards.map(d =>
          d.id === id
            ? {...d, settings, updatedAt: new Date().toISOString()}
            : d,
        ),
      );
    },
    [dashboards, persist],
  );

  const updateDashboardIcon = useCallback(
    (id: string, icon: string) => {
      persist(
        dashboards.map(d =>
          d.id === id ? {...d, icon, updatedAt: new Date().toISOString()} : d,
        ),
      );
    },
    [dashboards, persist],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = DASHBOARD_PRESETS.find(p => p.id === presetId);
      if (!preset) {
        return;
      }
      const id = createDashboard(preset.name, preset);
      return id;
    },
    [createDashboard],
  );

  const resetToDefault = useCallback(() => {
    persist([{...DEFAULT_DASHBOARD}], 'default');
    resetSnapshot({
      widgets: DEFAULT_DASHBOARD.widgets,
      layouts: DEFAULT_DASHBOARD.layouts,
    });
  }, [persist, resetSnapshot]);

  // web exportDashboard created a Blob + <a download> (browser-only). Native
  // returns the JSON string for the caller to Share; the actual download UX
  // lives in the inline ExportModal (rule 7).
  const exportDashboard = useCallback(
    (id?: string): string | undefined => {
      const dash = dashboards.find(d => d.id === (id ?? activeId));
      if (!dash) {
        return undefined;
      }
      return JSON.stringify(dash, null, 2);
    },
    [dashboards, activeId],
  );

  const importDashboardFromData = useCallback(
    (dashboard: SavedDashboard) => {
      const finalDash: SavedDashboard = {
        ...dashboard,
        layouts: reconcileLayouts(dashboard.layouts, dashboard.widgets),
        isDefault: false,
      };
      persist([...dashboardsRef.current, finalDash], finalDash.id);
      resetSnapshot({widgets: finalDash.widgets, layouts: finalDash.layouts});
    },
    [persist, resetSnapshot],
  );

  const autoArrange = useCallback(() => {
    const current = activeDashRef.current;
    const layouts = buildDefaultLayouts(current.widgets);
    pushSnapshot({widgets: current.widgets, layouts});
    updateActive(d => ({...d, layouts}));
  }, [updateActive, pushSnapshot]);

  const getWidgetSize = useCallback(
    (instanceId: string): {cols: number; rows: number} => {
      const lgLayout: RGLLayout[] = activeDashboard.layouts.lg ?? [];
      const item = lgLayout.find(l => l.i === instanceId);
      if (item) {
        return {cols: item.w, rows: item.h};
      }
      const widget = activeDashboard.widgets.find(w => w.id === instanceId);
      const def = widget ? getWidgetDef(widget.widgetId) : undefined;
      return def?.defaultSize ?? {cols: 1, rows: 1};
    },
    [activeDashboard],
  );

  const undo = useCallback(() => {
    const prev = undoSnapshot();
    if (prev) {
      updateActive(d => ({
        ...d,
        widgets: prev.widgets,
        layouts: reconcileLayouts(prev.layouts, prev.widgets),
      }));
    }
  }, [updateActive, undoSnapshot]);

  const redo = useCallback(() => {
    const next = redoSnapshot();
    if (next) {
      updateActive(d => ({
        ...d,
        widgets: next.widgets,
        layouts: reconcileLayouts(next.layouts, next.widgets),
      }));
    }
  }, [updateActive, redoSnapshot]);

  const pinToVehicle = useCallback(
    (id: string, vehicleId: number | null | undefined) => {
      persist(
        dashboards.map(d =>
          d.id === id
            ? {
                ...d,
                vehicleId: vehicleId ?? null,
                updatedAt: new Date().toISOString(),
              }
            : d,
        ),
      );
    },
    [dashboards, persist],
  );

  return {
    dashboards,
    activeDashboard,
    activeId,
    pinToVehicle,
    switchDashboard,
    createDashboard,
    renameDashboard,
    deleteDashboard,
    reorderDashboards,
    duplicateDashboard,
    updateDashboardSettings,
    updateDashboardIcon,
    applyPreset,
    resetToDefault,
    editMode,
    setEditMode,
    dirty,
    addWidget,
    addWidgets,
    removeWidget,
    updateWidgetConfig,
    updateLayouts,
    autoArrange,
    getWidgetSize,
    exportDashboard,
    importDashboardFromData,
    canUndo,
    canRedo,
    undoCount,
    undo,
    redo,
  };
}

// ===========================================================================
// useKioskMode (web ../hooks/useKioskMode)
//
// Native-safe: config + dashboard auto-rotation are preserved. The browser-only
// fullscreen request/exit, cursor auto-hide, screen-dim burn-in prevention and
// ?kiosk=true URL auto-entry are dropped (no fullscreen API / pointer / URL on
// native); isDimmed/isCursorHidden stay in the contract (always false).
// ===========================================================================

interface KioskConfig {
  rotateInterval: number;
  dashboardIds: string[];
  hideCursor: boolean;
  cursorTimeout: number;
  dimAfter: number;
  dimLevel: number;
  showClock: boolean;
  clockPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  widgetOpacity: number;
  backgroundOpacity: number;
}

const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  rotateInterval: 30,
  dashboardIds: [],
  hideCursor: true,
  cursorTimeout: 5,
  dimAfter: 0,
  dimLevel: 0.5,
  showClock: true,
  clockPosition: 'bottom-right',
  widgetOpacity: 1.0,
  backgroundOpacity: 1.0,
};

const KIOSK_CONFIG_KEY = 'teslasync-kiosk-config';

function loadKioskConfig(): KioskConfig {
  try {
    const saved = safeStorage.getItem(KIOSK_CONFIG_KEY);
    if (saved) {
      return {...DEFAULT_KIOSK_CONFIG, ...JSON.parse(saved)};
    }
  } catch {
    // ignore
  }
  return DEFAULT_KIOSK_CONFIG;
}

function saveKioskConfig(config: KioskConfig): void {
  try {
    safeStorage.setItem(KIOSK_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

function useKioskMode(
  dashboards: SavedDashboard[],
  activeId: string,
  switchDashboard: (id: string) => void,
) {
  const [config, setConfig] = useState<KioskConfig>(loadKioskConfig);
  const [isKiosk, setIsKiosk] = useState(false);
  const [isDimmed] = useState(false);
  const [isCursorHidden] = useState(false);
  const rotateTimer = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );

  const validIds = useMemo(() => {
    const existingIds = new Set(dashboards.map(d => d.id));
    const filtered = config.dashboardIds.filter(id => existingIds.has(id));
    return filtered.length > 0 ? filtered : dashboards.map(d => d.id);
  }, [config.dashboardIds, dashboards]);

  const rotateIndex = useMemo(() => {
    const idx = validIds.indexOf(activeId);
    return idx >= 0 ? idx : 0;
  }, [validIds, activeId]);

  const updateConfig = useCallback((updates: Partial<KioskConfig>) => {
    setConfig(prev => {
      const updated = {...prev, ...updates};
      saveKioskConfig(updated);
      return updated;
    });
  }, []);

  // web enterKiosk requested document fullscreen first; native just flips state.
  const enterKiosk = useCallback(() => {
    setIsKiosk(true);
  }, []);

  const exitKiosk = useCallback(() => {
    setIsKiosk(false);
    if (rotateTimer.current !== undefined) {
      clearInterval(rotateTimer.current);
    }
  }, []);

  useEffect(() => {
    if (!isKiosk || config.rotateInterval <= 0 || validIds.length <= 1) {
      return;
    }
    rotateTimer.current = setInterval(() => {
      const currentIdx = validIds.indexOf(activeId);
      const nextIdx = (currentIdx + 1) % validIds.length;
      switchDashboard(validIds[nextIdx]);
    }, config.rotateInterval * 1000);
    return () => {
      if (rotateTimer.current !== undefined) {
        clearInterval(rotateTimer.current);
      }
    };
  }, [isKiosk, config.rotateInterval, validIds, activeId, switchDashboard]);

  return {
    config,
    updateConfig,
    isKiosk,
    enterKiosk,
    exitKiosk,
    isDimmed,
    isCursorHidden,
    rotateIndex,
    validIds,
  };
}

// ===========================================================================
// useLayoutKeyboard (web ../hooks/useLayoutKeyboard)
//
// Entirely hardware-keyboard driven (E / Esc / ? / Ctrl+Z / Alt+1-9 window
// keydown listeners + the cheatsheet registry). Both are browser-only, so the
// native port is a no-op that keeps the options contract for call-site parity.
// ===========================================================================

interface KeyboardOptions {
  editMode: boolean;
  setEditMode: (next: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dashboards: SavedDashboard[];
  switchDashboard: (id: string) => void;
}

function useLayoutKeyboard(_options: KeyboardOptions): void {
  useEffect(() => {
    // No hardware keyboard shortcut bus on native.
  }, []);
}

// ===========================================================================
// Accent palette (web neon colours, toned for body per the parity convention)
// ===========================================================================

type BannerVariant = 'info' | 'warning' | 'danger';

const BANNER_STYLES: Record<
  BannerVariant,
  {bg: string; border: string; text: string}
> = {
  info: {bg: colors.accentSoft, border: colors.borderAccent, text: colors.accent},
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
};

// ===========================================================================
// Shared native primitives
// ===========================================================================

// web react-router-dom Link — no navigation target wired in this slice; the
// press is a documented no-op placeholder preserving the affordance + label.
function LinkText({
  children,
  onPress,
}: {
  to?: string;
  children: ReactNode;
  onPress?: () => void;
}): React.ReactElement {
  return (
    <Pressable accessibilityRole="link" onPress={onPress}>
      <AppText tone="accent" weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

function IconButton({
  glyph,
  label,
  onPress,
  disabled,
  active,
  badge,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: number;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.iconButton,
        active && styles.iconButtonActive,
        disabled && styles.iconButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText style={styles.iconGlyph}>{glyph}</AppText>
      {label ? (
        <AppText variant="caption" weight="semibold" style={styles.iconLabel}>
          {label}
        </AppText>
      ) : null}
      {badge != null && badge > 0 ? (
        <View style={styles.iconBadge}>
          <AppText variant="caption" weight="bold" style={styles.iconBadgeText}>
            {badge}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

// web @/components/feedback AlertBanner
function AlertBanner({
  variant = 'info',
  icon,
  title,
  onClose,
  children,
}: {
  variant?: BannerVariant;
  icon?: ReactNode;
  title?: string;
  onClose?: () => void;
  children?: ReactNode;
}): React.ReactElement {
  const palette = BANNER_STYLES[variant];
  return (
    <View
      style={[
        styles.banner,
        {backgroundColor: palette.bg, borderColor: palette.border},
      ]}>
      <View style={styles.bannerRow}>
        {icon ? <View style={styles.bannerIcon}>{icon}</View> : null}
        <View style={styles.bannerBody}>
          {title ? (
            <AppText weight="semibold" style={{color: palette.text}}>
              {title}
            </AppText>
          ) : null}
          {children}
        </View>
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={onClose}
            style={styles.bannerClose}>
            <AppText tone="muted">✕</AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// web @/components/feedback LiveStaleDataBanner — shows only after >2 min of a
// disconnected live SSE pipe. There is no live pipe in this native layer, so it
// can never be stale: render null.
function LiveStaleDataBanner(): React.ReactElement | null {
  return null;
}

// web @/components/data-display LiveIndicator (variant="compact") — a small live
// status pill. No useLiveConnection SSE here; render a static compact pill.
function LiveIndicator({
  variant: _variant = 'compact',
}: {
  variant?: 'compact' | 'full';
}): React.ReactElement {
  return (
    <View style={styles.livePill}>
      <View style={styles.liveDot} />
      <AppText variant="caption" weight="semibold" style={styles.liveText}>
        Live
      </AppText>
    </View>
  );
}

// web @/components/data-display DataFreshnessAuto — shows the query's last-update
// relative time. Reads the react-query `dataUpdatedAt` of the passed query.
function DataFreshnessAuto({
  query,
}: {
  query: Pick<UseQueryResult, 'dataUpdatedAt' | 'isFetching'>;
}): React.ReactElement | null {
  const {dataUpdatedAt, isFetching} = query;
  const label = useMemo(() => {
    if (!dataUpdatedAt) {
      return null;
    }
    const seconds = Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000));
    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    return `${Math.round(minutes / 60)}h ago`;
  }, [dataUpdatedAt]);
  if (!label) {
    return null;
  }
  return (
    <AppText variant="caption" tone="muted">
      {isFetching ? 'Updating…' : label}
    </AppText>
  );
}

// web @/components/ui PrintButton — browser window.print is unavailable on
// native; render a no-op button preserving the affordance (rule 7).
function PrintButton({label}: {label: string}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}>
      <AppText style={styles.iconGlyph}>🖨</AppText>
    </Pressable>
  );
}

// web @/components/motion FadeIn — passthrough View (no framer-motion).
function FadeIn({children}: {children: ReactNode}): React.ReactElement {
  return <View style={styles.section}>{children}</View>;
}

// web @/components/feedback Skeleton — static dimmed box (no CSS keyframes; an
// Animated.loop would register an open timer under --detectOpenHandles).
function Skeleton({height = 80}: {height?: number}): React.ReactElement {
  return <View style={[styles.skeleton, {height}]} />;
}

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

// web @/components/layout PageContainer — single ScrollView shell.
function PageContainer({
  title,
  subtitle,
  loading,
  actions,
  children,
}: PageContainerProps): React.ReactElement {
  return (
    <ScrollView
      style={styles.pageRoot}
      contentContainerStyle={styles.pageContent}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="secondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {loading ? (
        <View style={styles.pageLoadingBar}>
          <View style={styles.pageLoadingFill} />
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

// Generic native modal shell reused by the inline dialog ports (DRY).
function NativeModalShell({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
}): React.ReactElement {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        style={styles.modalBackdrop}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <AppText variant="title" weight="bold">
                {title}
              </AppText>
              {subtitle ? (
                <AppText variant="caption" tone="muted">
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.modalClose}>
              <AppText tone="muted">✕</AppText>
            </Pressable>
          </View>
          <ScrollView style={styles.modalScroll}>{children}</ScrollView>
          {footer ? <View style={styles.modalFooter}>{footer}</View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.primaryButton,
        disabled && styles.iconButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText weight="semibold" style={styles.primaryButtonText}>
        {label}
      </AppText>
    </Pressable>
  );
}

function GhostButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.ghostButton,
        disabled && styles.iconButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText weight="semibold">{label}</AppText>
    </Pressable>
  );
}

// ===========================================================================
// Inline native-safe dialog/picker ports (web ../components/*)
//
// Each preserves its web prop contract + primary behaviour; the full surfaces
// remain owned by their own conversion turns. Browser-only mechanics (file
// download, localStorage history, clipboard, drag-reorder) become native-safe.
// ===========================================================================

// web ../components/WidgetPicker — full drawer with category tabs + preset cards.
// Native-safe: lists presets (apply) + an "add all from preset" path; the rich
// per-widget catalogue is the converted WidgetCatalogueDialog (used elsewhere).
function WidgetPicker({
  open,
  onClose,
  onAddWidgets,
  onApplyPreset,
  activeWidgetIds,
}: {
  open: boolean;
  onClose: () => void;
  onAddWidgets: (widgetIds: string[]) => void;
  onApplyPreset: (presetId: string) => void;
  activeWidgetIds: string[];
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const active = new Set(activeWidgetIds);
  return (
    <NativeModalShell
      open={open}
      onClose={onClose}
      title={t('picker.title', 'Add Widgets')}
      subtitle={t('picker.subtitle', 'Choose a starter layout or widget')}>
      {DASHBOARD_PRESETS.map(preset => (
        <View key={preset.id} style={styles.listRow}>
          <View style={styles.listRowText}>
            <AppText weight="semibold">{preset.name}</AppText>
            <AppText variant="caption" tone="muted">
              {`${preset.widgets.length} widgets`}
            </AppText>
          </View>
          <View style={styles.listRowActions}>
            <GhostButton
              label={t('picker.addAll', 'Add all')}
              onPress={() => {
                onAddWidgets(
                  preset.widgets
                    .map(w => w.widgetId)
                    .filter(id => !active.has(id)),
                );
                onClose();
              }}
            />
            <PrimaryButton
              label={t('picker.apply', 'Apply')}
              onPress={() => {
                onApplyPreset(preset.id);
                onClose();
              }}
            />
          </View>
        </View>
      ))}
    </NativeModalShell>
  );
}

// web ../components/WidgetSettingsModal — per-widget config form (vehicle,
// refresh rate, chart type, show title). Native-safe: a compact form over the
// same WidgetConfig fields, preserving onSave.
function WidgetSettingsModal({
  widget,
  def,
  open,
  onClose,
  onSave,
}: {
  widget: WidgetInstance;
  def: WidgetDef;
  open: boolean;
  onClose: () => void;
  onSave: (config: WidgetConfig) => void;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const [showTitle, setShowTitle] = useState<boolean>(
    widget.config?.showTitle ?? true,
  );
  const [timeRange, setTimeRange] = useState<string>(
    widget.config?.timeRange ?? '',
  );
  useEffect(() => {
    if (open) {
      setShowTitle(widget.config?.showTitle ?? true);
      setTimeRange(widget.config?.timeRange ?? '');
    }
  }, [open, widget]);
  return (
    <NativeModalShell
      open={open}
      onClose={onClose}
      title={t('widgetSettings.title', 'Widget Settings')}
      subtitle={def.name}
      footer={
        <View style={styles.footerRow}>
          <GhostButton label={t('common.cancel', 'Cancel')} onPress={onClose} />
          <PrimaryButton
            label={t('common.save', 'Save')}
            onPress={() => {
              onSave({...widget.config, showTitle, timeRange});
              onClose();
            }}
          />
        </View>
      }>
      <ToggleRow
        label={t('widgetSettings.showTitle', 'Show title')}
        value={showTitle}
        onToggle={() => setShowTitle(v => !v)}
      />
      <View style={styles.formField}>
        <AppText variant="caption" tone="muted">
          {t('widgetSettings.timeRange', 'Time range')}
        </AppText>
        <TextInput
          value={timeRange}
          onChangeText={setTimeRange}
          placeholder="24h"
          placeholderTextColor={colors.textMuted}
          style={styles.textInput}
        />
      </View>
    </NativeModalShell>
  );
}

// web ../components/LayoutManager — chips + context menu (rename/delete/reorder/
// duplicate/settings/templates). Native-safe: a chip row with switch + an inline
// actions sheet preserving every callback. Drag-reorder uses up/down controls.
function LayoutManager({
  dashboards,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onDuplicate,
  onOpenSettings,
  onOpenTemplates,
}: {
  dashboards: SavedDashboard[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDuplicate: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onOpenTemplates?: () => void;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuDash = menuId ? dashboards.find(d => d.id === menuId) : null;
  const menuIndex = menuId ? dashboards.findIndex(d => d.id === menuId) : -1;
  return (
    <View style={styles.layoutManager}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chipRow}>
          {dashboards.map(d => (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              onPress={() => onSwitch(d.id)}
              onLongPress={() => setMenuId(d.id)}
              style={[
                styles.chip,
                d.id === activeId && styles.chipActive,
              ]}>
              <AppText
                variant="caption"
                weight="semibold"
                style={d.id === activeId ? styles.chipActiveText : undefined}>
                {`${d.icon ? `${d.icon} ` : ''}${d.name}`}
              </AppText>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('layoutManager.add', 'New layout')}
            onPress={() => onCreate(t('dashboard.newDashboard', 'New Dashboard'))}
            style={styles.chip}>
            <AppText variant="caption" weight="semibold">
              ＋
            </AppText>
          </Pressable>
          {onOpenTemplates ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('dashboard.templates', 'Templates')}
              onPress={onOpenTemplates}
              style={styles.chip}>
              <AppText variant="caption" weight="semibold">
                ▦
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
      <NativeModalShell
        open={menuId != null}
        onClose={() => setMenuId(null)}
        title={menuDash?.name ?? ''}>
        {menuDash ? (
          <View>
            <MenuRow
              glyph="✎"
              label={t('layoutManager.rename', 'Rename')}
              onPress={() => {
                onRename(menuDash.id, `${menuDash.name}`);
                setMenuId(null);
              }}
            />
            <MenuRow
              glyph="⧉"
              label={t('layoutManager.duplicate', 'Duplicate')}
              onPress={() => {
                onDuplicate(menuDash.id);
                setMenuId(null);
              }}
            />
            <MenuRow
              glyph="⚙"
              label={t('layoutManager.settings', 'Settings')}
              onPress={() => {
                onOpenSettings(menuDash.id);
                setMenuId(null);
              }}
            />
            <MenuRow
              glyph="↑"
              label={t('layoutManager.moveUp', 'Move up')}
              disabled={menuIndex <= 0}
              onPress={() => {
                onReorder(menuIndex, menuIndex - 1);
                setMenuId(null);
              }}
            />
            <MenuRow
              glyph="↓"
              label={t('layoutManager.moveDown', 'Move down')}
              disabled={menuIndex >= dashboards.length - 1}
              onPress={() => {
                onReorder(menuIndex, menuIndex + 1);
                setMenuId(null);
              }}
            />
            {!menuDash.isDefault ? (
              <MenuRow
                glyph="🗑"
                label={t('layoutManager.delete', 'Delete')}
                danger
                onPress={() => {
                  onDelete(menuDash.id);
                  setMenuId(null);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </NativeModalShell>
    </View>
  );
}

// web ../components/TemplateGallery — preset cards with previews.
function TemplateGallery({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (presetId: string) => void;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  return (
    <NativeModalShell
      open={open}
      onClose={onClose}
      title={t('templates.title', 'Template Gallery')}
      subtitle={t('templates.subtitle', 'Start from a ready-made layout')}>
      <View style={styles.listRow}>
        <View style={styles.listRowText}>
          <AppText weight="semibold">
            {t('templates.blank', 'Blank Dashboard')}
          </AppText>
          <AppText variant="caption" tone="muted">
            {t('templates.blankDesc', 'Start empty and add your own widgets')}
          </AppText>
        </View>
        <PrimaryButton
          label={t('templates.use', 'Use')}
          onPress={() => onApply('__blank__')}
        />
      </View>
      {DASHBOARD_PRESETS.map(preset => (
        <View key={preset.id} style={styles.listRow}>
          <View style={styles.listRowText}>
            <AppText weight="semibold">{preset.name}</AppText>
            <AppText variant="caption" tone="muted">
              {`${preset.widgets.length} widgets`}
            </AppText>
          </View>
          <PrimaryButton
            label={t('templates.use', 'Use')}
            onPress={() => onApply(preset.id)}
          />
        </View>
      ))}
    </NativeModalShell>
  );
}

// web ../components/ExportModal — JSON preview + copy/download. Native-safe: the
// download becomes React Native Share over the same JSON; onDownload preserved.
function ExportModal({
  open,
  onClose,
  dashboard,
  onDownload,
}: {
  open: boolean;
  onClose: () => void;
  dashboard: SavedDashboard;
  onDownload: () => void;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const dashboardJson = useMemo(
    () => JSON.stringify(dashboard, null, 2),
    [dashboard],
  );
  return (
    <NativeModalShell
      open={open}
      onClose={onClose}
      title={t('export.title', 'Export Dashboard')}
      subtitle={dashboard.name}
      footer={
        <View style={styles.footerRow}>
          <GhostButton label={t('common.close', 'Close')} onPress={onClose} />
          <PrimaryButton
            label={t('export.share', 'Share')}
            onPress={() => {
              onDownload();
              Share.share({message: dashboardJson}).catch(() => undefined);
            }}
          />
        </View>
      }>
      <View style={styles.codeBlock}>
        <AppText variant="caption" tone="secondary">
          {dashboardJson}
        </AppText>
      </View>
    </NativeModalShell>
  );
}

// web ../components/ImportPreviewModal — file/textarea JSON + validate + confirm.
// Native-safe: a TextInput seeded with initialJson; parse + confirm preserved.
function ImportPreviewModal({
  open,
  onClose,
  onConfirm,
  initialJson,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (dashboard: SavedDashboard) => void;
  initialJson?: string | null;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const [json, setJson] = useState<string>(initialJson ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setJson(initialJson ?? '');
      setError(null);
    }
  }, [open, initialJson]);
  const handleConfirm = () => {
    try {
      const parsed = JSON.parse(json) as SavedDashboard;
      if (!parsed.name || !parsed.widgets || !parsed.layouts) {
        setError(t('import.invalid', 'Invalid layout file'));
        return;
      }
      onConfirm(parsed);
      onClose();
    } catch {
      setError(t('import.parseError', 'Could not parse JSON'));
    }
  };
  return (
    <NativeModalShell
      open={open}
      onClose={onClose}
      title={t('import.title', 'Import Dashboard')}
      subtitle={t('import.subtitle', 'Paste a dashboard JSON to preview')}
      footer={
        <View style={styles.footerRow}>
          <GhostButton label={t('common.cancel', 'Cancel')} onPress={onClose} />
          <PrimaryButton
            label={t('import.confirm', 'Import')}
            onPress={handleConfirm}
            disabled={json.trim().length === 0}
          />
        </View>
      }>
      <TextInput
        value={json}
        onChangeText={setJson}
        multiline
        placeholder='{"name":"My Dashboard", ...}'
        placeholderTextColor={colors.textMuted}
        style={[styles.textInput, styles.textArea]}
      />
      {error ? (
        <AppText variant="caption" style={{color: colors.danger}}>
          {error}
        </AppText>
      ) : null}
    </NativeModalShell>
  );
}

interface VehicleOption {
  id: number;
  display_name: string;
}

// web ../components/DashboardSettingsModal — name, icon, vehicle scope, refresh
// interval, borders + compact toggles. Native-safe form preserving all callbacks.
function DashboardSettingsModal({
  open,
  onClose,
  dashboard,
  vehicles,
  onUpdate,
  onRename,
  onChangeIcon,
}: {
  open: boolean;
  onClose: () => void;
  dashboard: SavedDashboard;
  vehicles: VehicleOption[];
  onUpdate: (settings: DashboardSettings) => void;
  onRename: (name: string) => void;
  onChangeIcon: (icon: string) => void;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const [name, setName] = useState(dashboard.name);
  const [icon, setIcon] = useState(dashboard.icon ?? '');
  const [showBorders, setShowBorders] = useState(
    dashboard.settings?.showWidgetBorders ?? false,
  );
  const [compact, setCompact] = useState(
    dashboard.settings?.compactMode ?? false,
  );
  useEffect(() => {
    if (open) {
      setName(dashboard.name);
      setIcon(dashboard.icon ?? '');
      setShowBorders(dashboard.settings?.showWidgetBorders ?? false);
      setCompact(dashboard.settings?.compactMode ?? false);
    }
  }, [open, dashboard]);
  return (
    <NativeModalShell
      open={open}
      onClose={onClose}
      title={t('dashSettings.title', 'Dashboard Settings')}
      footer={
        <View style={styles.footerRow}>
          <GhostButton label={t('common.cancel', 'Cancel')} onPress={onClose} />
          <PrimaryButton
            label={t('common.save', 'Save')}
            onPress={() => {
              onRename(name);
              onChangeIcon(icon);
              onUpdate({
                refreshInterval: dashboard.settings?.refreshInterval ?? 0,
                vehicleId: dashboard.settings?.vehicleId,
                showWidgetBorders: showBorders,
                compactMode: compact,
              });
              onClose();
            }}
          />
        </View>
      }>
      <View style={styles.formField}>
        <AppText variant="caption" tone="muted">
          {t('dashSettings.name', 'Name')}
        </AppText>
        <TextInput
          value={name}
          onChangeText={setName}
          style={styles.textInput}
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <View style={styles.formField}>
        <AppText variant="caption" tone="muted">
          {t('dashSettings.icon', 'Icon (emoji)')}
        </AppText>
        <TextInput
          value={icon}
          onChangeText={setIcon}
          style={styles.textInput}
          placeholder="🚗"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <ToggleRow
        label={t('dashSettings.showBorders', 'Show widget borders')}
        value={showBorders}
        onToggle={() => setShowBorders(v => !v)}
      />
      <ToggleRow
        label={t('dashSettings.compact', 'Compact mode')}
        value={compact}
        onToggle={() => setCompact(v => !v)}
      />
      {vehicles.length > 0 ? (
        <AppText variant="caption" tone="muted" style={styles.formHint}>
          {t('dashSettings.vehicleHint', '{{count}} vehicles available', {
            count: vehicles.length,
          })}
        </AppText>
      ) : null}
    </NativeModalShell>
  );
}

// web ../components/KioskOverlay — floating clock + rotation dots + exit. Native:
// a top exit bar + rotation indicator. isDimmed/isCursorHidden are accepted.
function KioskOverlay({
  config,
  isDimmed: _isDimmed,
  isCursorHidden: _isCursorHidden,
  dashboardCount,
  currentIndex,
  onExit,
}: {
  config: KioskConfig;
  isDimmed: boolean;
  isCursorHidden: boolean;
  dashboardCount: number;
  currentIndex: number;
  onExit: () => void;
}): React.ReactElement {
  return (
    <View style={styles.kioskOverlay} pointerEvents="box-none">
      <View style={styles.kioskBar}>
        {config.showClock ? (
          <AppText variant="caption" tone="secondary">
            {`${currentIndex + 1} / ${dashboardCount}`}
          </AppText>
        ) : (
          <View />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Exit kiosk"
          onPress={onExit}
          style={styles.kioskExit}>
          <AppText variant="caption" weight="semibold">
            ✕ Exit
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

// web ../components/KioskSettingsModal — rotation/clock/opacity config + enter.
function KioskSettingsModal({
  open,
  onClose,
  config,
  onUpdateConfig,
  onEnterKiosk,
  dashboards,
}: {
  open: boolean;
  onClose: () => void;
  config: KioskConfig;
  onUpdateConfig: (updates: Partial<KioskConfig>) => void;
  onEnterKiosk: () => void;
  dashboards: SavedDashboard[];
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const rotationOptions = [0, 10, 15, 30, 60];
  return (
    <NativeModalShell
      open={open}
      onClose={onClose}
      title={t('kiosk.title', 'Kiosk Mode')}
      subtitle={t('kiosk.subtitle', '{{count}} dashboards in rotation', {
        count: dashboards.length,
      })}
      footer={
        <View style={styles.footerRow}>
          <GhostButton label={t('common.close', 'Close')} onPress={onClose} />
          <PrimaryButton
            label={t('kiosk.enter', 'Enter Kiosk')}
            onPress={() => {
              onClose();
              onEnterKiosk();
            }}
          />
        </View>
      }>
      <AppText variant="caption" tone="muted" style={styles.formField}>
        {t('kiosk.rotation', 'Rotation interval')}
      </AppText>
      <View style={styles.chipRow}>
        {rotationOptions.map(opt => (
          <Pressable
            key={opt}
            accessibilityRole="button"
            onPress={() => onUpdateConfig({rotateInterval: opt})}
            style={[
              styles.chip,
              config.rotateInterval === opt && styles.chipActive,
            ]}>
            <AppText
              variant="caption"
              weight="semibold"
              style={
                config.rotateInterval === opt
                  ? styles.chipActiveText
                  : undefined
              }>
              {opt === 0 ? t('kiosk.off', 'Off') : `${opt}s`}
            </AppText>
          </Pressable>
        ))}
      </View>
      <ToggleRow
        label={t('kiosk.showClock', 'Show clock')}
        value={config.showClock}
        onToggle={() => onUpdateConfig({showClock: !config.showClock})}
      />
    </NativeModalShell>
  );
}

// web ../components/AddWidgetButton — floating action button. Hidden in edit mode.
function AddWidgetButton({
  onClick,
  isEditing,
}: {
  onClick: () => void;
  isEditing: boolean;
}): React.ReactElement | null {
  const {t} = useTranslation();
  if (isEditing) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('dashboard.addWidget', 'Add Widget')}
      onPress={onClick}
      style={({pressed}) => [styles.fab, pressed && styles.pressed]}>
      <AppText weight="bold" style={styles.fabGlyph}>
        ＋
      </AppText>
    </Pressable>
  );
}

// web ../components/RecentlyViewedWidget — tracks recently-viewed routes via
// localStorage. No route history wired in this slice; render the empty
// placeholder affordance (its full body is its own conversion turn).
function RecentlyViewedWidget(): React.ReactElement {
  const {t} = useTranslation('dashboard');
  return (
    <GlassPanel style={styles.recentPanel}>
      <AppText variant="caption" weight="semibold" tone="secondary">
        {t('recentlyViewed.title', 'Recently Viewed')}
      </AppText>
      <AppText variant="caption" tone="muted">
        {t(
          'recentlyViewed.empty',
          'Pages you visit will appear here for quick access.',
        )}
      </AppText>
    </GlassPanel>
  );
}

// Small shared rows used by the inline dialogs.
function ToggleRow({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked: value}}
      onPress={onToggle}
      style={styles.toggleRow}>
      <AppText>{label}</AppText>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

function MenuRow({
  glyph,
  label,
  onPress,
  danger,
  disabled,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.menuRow,
        disabled && styles.iconButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText style={styles.menuGlyph}>{glyph}</AppText>
      <AppText style={danger ? {color: colors.danger} : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}

// ===========================================================================
// ThemeFirstRunBanner (web L79-129)
//
// First-run theme prompt. Renders once for users still on the default theme
// (themeId === 'neon-cyan') who haven't dismissed it. The web localStorage
// persistence + open-theme-popover CustomEvent become in-memory state + a no-op
// (no theme popover wired in this slice).
// ===========================================================================

const THEME_FIRST_RUN_KEY = 'teslasync:themeFirstRunDismissed:v1';

function ThemeFirstRunBanner(): React.ReactElement | null {
  const {t} = useTranslation();
  const {themeId} = useTheme();
  const [dismissed, setDismissed] = useState<boolean>(
    () => safeStorage.getItem(THEME_FIRST_RUN_KEY) === '1',
  );

  if (dismissed) {
    return null;
  }
  if (themeId !== 'neon-cyan') {
    return null;
  }

  const persistDismiss = () => {
    safeStorage.setItem(THEME_FIRST_RUN_KEY, '1');
    setDismissed(true);
  };

  const openPicker = () => {
    // web dispatched 'open-theme-popover'; no theme popover on native.
    persistDismiss();
  };

  return (
    <AlertBanner
      variant="info"
      icon={<AppText>🎨</AppText>}
      title={t('theme.firstRunTitle', 'Personalize TeslaSync')}
      onClose={persistDismiss}>
      <View style={styles.bannerActions}>
        <AppText style={styles.bannerText}>
          {t('theme.firstRunBody', 'Pick a color theme that fits your style.')}
        </AppText>
        <View style={styles.bannerButtons}>
          <PrimaryButton
            label={t('theme.firstRunOpen', 'Open theme picker')}
            onPress={openPicker}
          />
          <GhostButton
            label={t('theme.firstRunLater', 'Maybe later')}
            onPress={persistDismiss}
          />
        </View>
      </View>
    </AlertBanner>
  );
}

// ===========================================================================
// DashboardPage (web L131-681)
// ===========================================================================

const DEFAULT_WIDGET_IDS = new Set<string>([
  'onboarding-checklist',
  'vehicle-hero',
  'battery-gauge',
  'climate-status',
  'recent-drives',
  'charge-status',
  'security-status',
  'quick-nav',
]);

const CUSTOMIZE_HINT_DISMISSED_KEY =
  'teslasync:dashboard:customizeHintDismissed:v1';
const CUSTOMIZE_HINT_DELAY_MS = 5_000;

export default function DashboardPage(): React.ReactElement {
  usePageTitle('Dashboard');
  const {t} = useTranslation('dashboard');
  const queryClient = useQueryClient();

  /* ——— Dashboard layout state ——— */
  const {
    dashboards,
    activeDashboard,
    activeId,
    editMode,
    setEditMode,
    addWidgets,
    removeWidget,
    updateWidgetConfig,
    updateLayouts,
    autoArrange,
    getWidgetSize,
    switchDashboard,
    createDashboard,
    renameDashboard,
    deleteDashboard,
    reorderDashboards,
    duplicateDashboard,
    updateDashboardSettings,
    updateDashboardIcon,
    applyPreset,
    resetToDefault,
    exportDashboard,
    importDashboardFromData,
    canUndo,
    canRedo,
    undoCount,
    undo,
    redo,
    dirty,
    pinToVehicle,
  } = useDashboardLayout();
  const [showPicker, setShowPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState<string | null>(null);
  const [showKioskSettings, setShowKioskSettings] = useState(false);
  const [showDashSettings, setShowDashSettings] = useState<string | null>(null);
  useLayoutKeyboard({
    editMode,
    setEditMode,
    canUndo,
    canRedo,
    onUndo: undo,
    onRedo: redo,
    dashboards,
    switchDashboard,
  });
  const [settingsWidgetId, setSettingsWidgetId] = useState<string | null>(null);

  /* ——— Widget-add discovery ——— */
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState<boolean>(
    () => safeStorage.getItem(CUSTOMIZE_HINT_DISMISSED_KEY) === '1',
  );
  const [hintReady, setHintReady] = useState(false);
  const isOnlyDefault =
    activeDashboard.widgets.length > 0 &&
    activeDashboard.widgets.every(w => DEFAULT_WIDGET_IDS.has(w.widgetId));
  useEffect(() => {
    if (!isOnlyDefault || hintDismissed || editMode) {
      setHintReady(false);
      return undefined;
    }
    const id = setTimeout(() => setHintReady(true), CUSTOMIZE_HINT_DELAY_MS);
    return () => clearTimeout(id);
  }, [isOnlyDefault, hintDismissed, editMode]);
  const dismissHint = () => {
    setHintDismissed(true);
    setHintReady(false);
    safeStorage.setItem(CUSTOMIZE_HINT_DISMISSED_KEY, '1');
  };
  const handleCatalogueAdd = (widgetId: string) => {
    addWidgets([widgetId]);
    markCustomizeDashboardCompleted();
    dismissHint();
  };

  /* ——— Kiosk mode ——— */
  const {
    config: kioskConfig,
    updateConfig: updateKioskConfig,
    isKiosk,
    enterKiosk,
    exitKiosk,
    isDimmed,
    isCursorHidden,
    rotateIndex,
    validIds,
  } = useKioskMode(dashboards, activeId, switchDashboard);

  /* ——— Auth status ——— */
  const {data: auth} = useAuthStatus();
  const syncVehicles = useSyncVehicles();

  /* ——— SSE real-time connection ——— */
  useRealtimeEvents({
    onVehicleUpdate: () =>
      queryClient.invalidateQueries({queryKey: ['vehicles']}),
    onFallbackToPolling: () => queryClient.invalidateQueries(),
  });

  /* ——— Core data queries ——— */
  const vehiclesQuery = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });
  const {
    data: vehicles,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = vehiclesQuery;
  const {data: alerts, error: alertsError} = useQuery({
    queryKey: ['alerts'],
    queryFn: () => request<ApiAlert[]>('/alerts?limit=10'),
  });

  /* ——— Derived values ——— */
  const unreadAlerts = alerts?.filter(a => !a.is_read).length ?? 0;
  const anyError = [vehiclesError, alertsError].find(Boolean) as
    | Error
    | undefined;

  /* ——— Refresh logic ——— */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(tk => tk + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({queryKey: ['vehicle-state']}),
      queryClient.invalidateQueries({queryKey: ['vehicles']}),
      queryClient.invalidateQueries({queryKey: ['fleet-analytics']}),
      queryClient.invalidateQueries({queryKey: ['drives']}),
      queryClient.invalidateQueries({queryKey: ['charging']}),
      queryClient.invalidateQueries({queryKey: ['alerts']}),
      queryClient.invalidateQueries({queryKey: ['motor-latest']}),
      queryClient.invalidateQueries({queryKey: ['climate-latest']}),
      queryClient.invalidateQueries({queryKey: ['security-latest']}),
      queryClient.invalidateQueries({queryKey: ['tire-latest']}),
    ]);
    setIsRefreshing(false);
  };

  /* ——— Import handler ——— */
  const handleImportConfirm = (dashboard: SavedDashboard) => {
    importDashboardFromData(dashboard);
  };

  /* ——— URL import detection ——— */
  // web read window.location.hash for #import=… payloads. There is no URL hash
  // on native, so this is a no-op; fromUrlSafeBase64 is retained for parity.
  useEffect(() => {
    const hash = '';
    if (hash.startsWith('#import=')) {
      try {
        const encoded = hash.slice('#import='.length);
        const json = fromUrlSafeBase64(encoded);
        setImportJson(json);
        setShowImportModal(true);
      } catch {
        // Invalid base64 — ignore.
      }
    }
  }, []);

  /* ——— Command-palette bridge ——— */
  // web wired window dashboard:* CustomEvents from the command palette. There is
  // no command palette / window event bus on native, so this is a no-op.
  useEffect(() => {
    return () => {
      // No window listeners to detach.
    };
  }, [editMode, setEditMode, resetToDefault, t]);

  /* ——— Template gallery handler ——— */
  const handleApplyTemplate = (presetId: string) => {
    if (presetId === '__blank__') {
      createDashboard(t('dashboard.newDashboard', 'New Dashboard'));
    } else {
      applyPreset(presetId);
    }
    setShowTemplates(false);
  };

  /* ——— Widget settings ——— */
  const settingsWidget = settingsWidgetId
    ? activeDashboard.widgets.find(w => w.id === settingsWidgetId)
    : null;
  const settingsDef = settingsWidget
    ? getWidgetDef(settingsWidget.widgetId)
    : null;

  const handleSaveWidgetConfig = (config: WidgetConfig) => {
    if (settingsWidgetId) {
      updateWidgetConfig(settingsWidgetId, config);
    }
  };

  /* ——— Header actions ——— */
  const headerActions = (
    <View style={styles.headerActions}>
      {editMode ? (
        <>
          <View style={styles.headerGroup}>
            <IconButton
              glyph="↶"
              label=""
              onPress={undo}
              disabled={!canUndo}
            />
            <IconButton
              glyph="↷"
              label=""
              onPress={redo}
              disabled={!canRedo}
            />
            {canUndo ? (
              <AppText variant="caption" tone="muted">
                {String(undoCount)}
              </AppText>
            ) : null}
          </View>
          <IconButton
            glyph="＋"
            label={t('dashboard.addWidget', 'Add Widget')}
            onPress={() => setShowPicker(true)}
          />
          <IconButton
            glyph="▦"
            label={t('dashboard.autoArrange', 'Auto Arrange')}
            onPress={autoArrange}
          />
          <IconButton
            glyph="▤"
            label={t('dashboard.templates', 'Templates')}
            onPress={() => setShowTemplates(true)}
          />
          <IconButton
            glyph="↺"
            label={t('dashboard.reset', 'Reset')}
            onPress={resetToDefault}
          />
          <PrimaryButton
            label={t('dashboard.done', 'Done')}
            onPress={() => setEditMode(false)}
          />
        </>
      ) : (
        <>
          <IconButton
            glyph="⟳"
            label=""
            onPress={handleRefresh}
            active={isRefreshing}
          />
          <IconButton
            glyph="⭳"
            label=""
            onPress={() => setShowExportModal(true)}
          />
          <IconButton
            glyph="⭱"
            label=""
            onPress={() => {
              setImportJson(null);
              setShowImportModal(true);
            }}
          />
          <IconButton
            glyph="📺"
            label={t('dashboard.kiosk', 'Kiosk')}
            onPress={() => setShowKioskSettings(true)}
          />
          <IconButton
            glyph="⚙"
            label={t('dashboard.customize', 'Customize')}
            onPress={() => setEditMode(true)}
          />
        </>
      )}
      {!editMode && unreadAlerts > 0 ? (
        <IconButton
          glyph="🔔"
          label=""
          onPress={() => {}}
          badge={unreadAlerts}
        />
      ) : null}
      <LiveIndicator variant="compact" />
      <DataFreshnessAuto query={vehiclesQuery} />
      {!editMode ? (
        <PrintButton label={t('dashboard.printSnapshot', 'Print snapshot')} />
      ) : null}
    </View>
  );

  return (
    <PageContainer
      title={t('title', 'Command Center')}
      subtitle={t('subtitle', 'Real-time fleet intelligence and control')}
      loading={vehiclesLoading}
      actions={headerActions}>
      <View style={styles.pageStack}>
        {/* First-run prompt to surface the theme picker. */}
        <ThemeFirstRunBanner />

        {/* Live-pipe stale-data warning. */}
        <LiveStaleDataBanner />

        {/* Soft hint that the dashboard is customizable. */}
        {hintReady && !editMode ? (
          <AlertBanner
            variant="info"
            icon={<AppText>＋</AppText>}
            onClose={dismissHint}>
            <View style={styles.bannerActions}>
              <AppText style={styles.bannerText}>
                {t(
                  'dashboard.customizeHint',
                  'You can customize this dashboard. Tap the + to add widgets.',
                )}
              </AppText>
              <PrimaryButton
                label={t('dashboard.customizeHintCta', 'Add widgets')}
                onPress={() => {
                  setCatalogueOpen(true);
                  dismissHint();
                }}
              />
            </View>
          </AlertBanner>
        ) : null}

        {/* Error banner */}
        {anyError ? (
          <AlertBanner variant="danger" icon={<AppText>⚠</AppText>}>
            <AppText style={styles.bannerText}>
              {`${t('error.loadFailed', 'Failed to load data')}: ${
                anyError.message
              }`}
            </AppText>
          </AlertBanner>
        ) : null}

        {/* Auth warning */}
        {auth && !auth.authenticated ? (
          <FadeIn>
            <AlertBanner
              variant="warning"
              icon={<AppText>⚠</AppText>}
              title={t('auth.notConnected', 'Tesla account not connected')}>
              <View style={styles.bannerInline}>
                <AppText style={styles.bannerText}>
                  {t('auth.connectPrompt', 'Connect your account in')}{' '}
                </AppText>
                <LinkText to="/settings">
                  {t('auth.settings', 'Settings')}
                </LinkText>
                <AppText style={styles.bannerText}>
                  {' '}
                  {t('auth.toStart', 'to start tracking.')}
                </AppText>
              </View>
            </AlertBanner>
          </FadeIn>
        ) : null}

        {/* Recently viewed widget. */}
        <FadeIn>
          <RecentlyViewedWidget />
        </FadeIn>

        {/* Layout Manager — always show when there are dashboards */}
        {dashboards.length > 0 ? (
          <View style={styles.layoutStack}>
            <LayoutSwitcher
              dashboards={dashboards}
              activeId={activeId}
              dirty={dirty}
              editMode={editMode}
              onSwitch={switchDashboard}
              onCreate={name => createDashboard(name)}
              onDuplicate={duplicateDashboard}
              onReset={resetToDefault}
              onToggleEdit={() => setEditMode(!editMode)}
              onPinToVehicle={pinToVehicle}
            />
            <LayoutManager
              dashboards={dashboards}
              activeId={activeId}
              onSwitch={switchDashboard}
              onCreate={createDashboard}
              onRename={renameDashboard}
              onDelete={deleteDashboard}
              onReorder={reorderDashboards}
              onDuplicate={duplicateDashboard}
              onOpenSettings={id => setShowDashSettings(id)}
              onOpenTemplates={() => setShowTemplates(true)}
            />
          </View>
        ) : null}

        {vehiclesLoading ? (
          <LoadingSkeleton />
        ) : vehicles && vehicles.length > 0 ? (
          <>
            {/* Edit mode hint */}
            {editMode ? (
              <FadeIn>
                <View style={styles.editHint}>
                  <AppText variant="caption" tone="secondary">
                    {t(
                      'dashboard.editHint',
                      'Drag widgets to reorder, resize from edges. Click the gear icon for widget settings.',
                    )}
                  </AppText>
                </View>
              </FadeIn>
            ) : null}

            {/* Widget Grid */}
            <FadeIn>
              <View>
                <DashboardGrid
                  dashboard={activeDashboard}
                  editMode={editMode}
                  onLayoutChange={updateLayouts}
                  onRemoveWidget={removeWidget}
                  onOpenSettings={setSettingsWidgetId}
                  getWidgetSize={getWidgetSize}
                  dashboardVehicleId={activeDashboard.settings?.vehicleId}
                  compactMode={activeDashboard.settings?.compactMode}
                  showWidgetBorders={activeDashboard.settings?.showWidgetBorders}
                />
              </View>
            </FadeIn>
          </>
        ) : (
          <FadeIn>
            <EmptyOnboarding
              authenticated={auth?.authenticated ?? false}
              onSync={() => syncVehicles.mutate()}
              isSyncing={syncVehicles.isPending}
            />
          </FadeIn>
        )}
      </View>

      {/* Widget Picker Drawer */}
      <WidgetPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onAddWidgets={addWidgets}
        onApplyPreset={applyPreset}
        activeWidgetIds={activeDashboard.widgets.map(w => w.widgetId)}
      />

      {/* Template Gallery Modal */}
      <TemplateGallery
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onApply={handleApplyTemplate}
      />

      {/* Widget Settings Modal */}
      {settingsWidget && settingsDef ? (
        <WidgetSettingsModal
          widget={settingsWidget}
          def={settingsDef}
          open={!!settingsWidgetId}
          onClose={() => setSettingsWidgetId(null)}
          onSave={handleSaveWidgetConfig}
        />
      ) : null}

      {/* Export Modal */}
      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        dashboard={activeDashboard}
        onDownload={() => exportDashboard()}
      />

      {/* Import Preview Modal */}
      <ImportPreviewModal
        open={showImportModal}
        onClose={() => {
          setShowImportModal(false);
          setImportJson(null);
        }}
        onConfirm={handleImportConfirm}
        initialJson={importJson}
      />

      {/* Kiosk Settings Modal */}
      <KioskSettingsModal
        open={showKioskSettings}
        onClose={() => setShowKioskSettings(false)}
        config={kioskConfig}
        onUpdateConfig={updateKioskConfig}
        onEnterKiosk={enterKiosk}
        dashboards={dashboards}
      />

      {/* Dashboard Settings Modal */}
      {showDashSettings ? (
        <DashboardSettingsModal
          open={!!showDashSettings}
          onClose={() => setShowDashSettings(null)}
          dashboard={
            dashboards.find(d => d.id === showDashSettings) ?? activeDashboard
          }
          vehicles={(vehicles ?? []).map(v => ({
            id: v.id,
            display_name: v.display_name,
          }))}
          onUpdate={settings =>
            updateDashboardSettings(showDashSettings, settings)
          }
          onRename={name => renameDashboard(showDashSettings, name)}
          onChangeIcon={icon => updateDashboardIcon(showDashSettings, icon)}
        />
      ) : null}

      {/* Discoverable add-widget surface. */}
      {!isKiosk ? (
        <AddWidgetButton
          onClick={() => setCatalogueOpen(true)}
          isEditing={editMode}
        />
      ) : null}
      <WidgetCatalogueDialog
        open={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        onAdd={handleCatalogueAdd}
        activeWidgetIds={activeDashboard.widgets.map(w => w.widgetId)}
      />

      {/* Kiosk Mode — a native full-screen Modal (web createPortal to body). */}
      <Modal
        visible={isKiosk}
        animationType="fade"
        onRequestClose={exitKiosk}>
        <View
          style={[
            styles.kioskRoot,
            {
              backgroundColor: `rgba(10, 10, 20, ${
                kioskConfig.backgroundOpacity ?? 1
              })`,
            },
          ]}>
          <ScrollView contentContainerStyle={styles.kioskScroll}>
            <DashboardGrid
              dashboard={activeDashboard}
              editMode={false}
              onLayoutChange={() => {}}
              onRemoveWidget={() => {}}
              onOpenSettings={() => {}}
              getWidgetSize={getWidgetSize}
              dashboardVehicleId={activeDashboard.settings?.vehicleId}
              compactMode={activeDashboard.settings?.compactMode}
              showWidgetBorders={activeDashboard.settings?.showWidgetBorders}
              kioskWidgetOpacity={kioskConfig.widgetOpacity ?? 1}
            />
          </ScrollView>
          <KioskOverlay
            config={kioskConfig}
            isDimmed={isDimmed}
            isCursorHidden={isCursorHidden}
            dashboardCount={validIds.length}
            currentIndex={rotateIndex}
            onExit={exitKiosk}
          />
        </View>
      </Modal>
    </PageContainer>
  );
}

// ===========================================================================
// EmptyOnboarding (web L683-733)
// ===========================================================================

function EmptyOnboarding({
  authenticated,
  onSync,
  isSyncing,
}: {
  authenticated: boolean;
  onSync: () => void;
  isSyncing: boolean;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const features: {glyph: string; label: string; color: string}[] = [
    {
      glyph: '⚡',
      label: t('onboarding.tracking', 'Real-time Tracking'),
      color: '#00f0ff',
    },
    {glyph: '🚗', label: t('onboarding.drives', 'Drive History'), color: '#a855f7'},
    {
      glyph: '🔋',
      label: t('onboarding.charging', 'Charge Analytics'),
      color: '#10b981',
    },
    {
      glyph: '🛡',
      label: t('onboarding.control', 'Vehicle Control'),
      color: '#ef4444',
    },
  ];
  return (
    <GlassPanel style={styles.onboardingPanel}>
      <AppText variant="title" weight="bold" style={styles.onboardingTitle}>
        {authenticated
          ? t('onboarding.syncTitle', 'Sync Your Vehicles')
          : t('onboarding.title', 'Welcome to TeslaSync')}
      </AppText>
      <AppText tone="secondary" style={styles.onboardingDesc}>
        {authenticated
          ? t(
              'onboarding.syncDesc',
              'Your Tesla account is connected. Sync your vehicles to start tracking.',
            )
          : t(
              'onboarding.desc',
              'The next-generation Tesla fleet intelligence platform. Connect your Tesla account to start real-time monitoring, analytics, and vehicle control.',
            )}
      </AppText>
      <View style={styles.onboardingAction}>
        {authenticated ? (
          <PrimaryButton
            label={
              isSyncing
                ? t('onboarding.syncing', 'Syncing…')
                : t('onboarding.sync', 'Sync Vehicles')
            }
            onPress={onSync}
            disabled={isSyncing}
          />
        ) : (
          <LinkText to="/settings">
            {`${t('onboarding.connect', 'Connect Tesla Account')} ›`}
          </LinkText>
        )}
      </View>
      <View style={styles.onboardingGrid}>
        {features.map(f => (
          <GlassPanel key={f.label} style={styles.onboardingFeature}>
            <AppText style={[styles.onboardingFeatureGlyph, {color: f.color}]}>
              {f.glyph}
            </AppText>
            <AppText variant="caption" weight="semibold" tone="secondary">
              {f.label}
            </AppText>
          </GlassPanel>
        ))}
      </View>
    </GlassPanel>
  );
}

// ===========================================================================
// LoadingSkeleton (web L735-745)
// ===========================================================================

function LoadingSkeleton(): React.ReactElement {
  return (
    <View style={styles.loadingStack}>
      <Skeleton height={288} />
      <View style={styles.loadingGrid}>
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} height={112} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Page shell
  pageRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.md,
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  pageHeaderText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageActions: {
    flexShrink: 1,
  },
  pageLoadingBar: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  pageLoadingFill: {
    width: '40%',
    height: '100%',
    backgroundColor: colors.accent,
  },
  pageStack: {
    gap: spacing.md,
  },
  layoutStack: {
    gap: spacing.sm,
  },
  section: {
    width: '100%',
  },

  // Header action bar
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  headerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  // Icon button
  iconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconButtonActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  iconButtonDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.82,
  },
  iconGlyph: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  iconLabel: {
    color: colors.textSecondary,
  },
  iconBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  iconBadgeText: {
    fontSize: 9,
    color: colors.background,
  },

  // Buttons
  primaryButton: {
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  ghostButton: {
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  // Banners
  banner: {
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.md,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  bannerIcon: {
    marginTop: 2,
  },
  bannerBody: {
    flex: 1,
    gap: spacing.xs,
  },
  bannerClose: {
    padding: spacing.xs,
  },
  bannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bannerButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bannerText: {
    flexShrink: 1,
    color: colors.textSecondary,
  },
  bannerInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },

  // Live indicator
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  liveText: {
    color: colors.success,
  },

  // Skeleton
  skeleton: {
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
  },

  // Edit hint
  editHint: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },

  // Modal shell
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 14, 0.72)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    maxHeight: '82%',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  modalClose: {
    padding: spacing.xs,
  },
  modalScroll: {
    paddingHorizontal: spacing.lg,
  },
  modalFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },

  // List rows (pickers / galleries)
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listRowText: {
    flex: 1,
    gap: 2,
  },
  listRowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // Forms
  formField: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  formHint: {
    marginTop: spacing.sm,
  },
  textInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
  },
  textArea: {
    minHeight: 160,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  codeBlock: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    marginBottom: spacing.md,
  },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 3,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.textMuted,
  },
  toggleThumbOn: {
    backgroundColor: colors.accent,
    alignSelf: 'flex-end',
  },

  // Layout manager
  layoutManager: {
    gap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  chipActiveText: {
    color: colors.accent,
  },

  // Menu rows
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuGlyph: {
    width: 24,
    fontSize: 16,
    color: colors.textSecondary,
  },

  // Recently viewed
  recentPanel: {
    padding: spacing.md,
    gap: spacing.xs,
  },

  // Onboarding
  onboardingPanel: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  onboardingTitle: {
    textAlign: 'center',
  },
  onboardingDesc: {
    textAlign: 'center',
    maxWidth: 440,
  },
  onboardingAction: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  onboardingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  onboardingFeature: {
    width: 150,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  onboardingFeatureGlyph: {
    fontSize: 22,
  },

  // Loading
  loadingStack: {
    gap: spacing.lg,
  },
  loadingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 8},
    elevation: 10,
  },
  fabGlyph: {
    fontSize: 26,
    color: colors.background,
  },

  // Kiosk
  kioskRoot: {
    flex: 1,
  },
  kioskScroll: {
    padding: spacing.lg,
    paddingTop: spacing.xxl,
    gap: spacing.md,
  },
  kioskOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  kioskBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  kioskExit: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
