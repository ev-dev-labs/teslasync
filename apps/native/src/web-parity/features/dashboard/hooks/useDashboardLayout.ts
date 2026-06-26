/**
 * Native parity port of
 * web/src/features/dashboard/hooks/useDashboardLayout.ts.
 *
 * This is non-visual state/logic code: a multi-dashboard layout manager with
 * undo/redo, preset library, backend sync, and (on web) cross-tab + DOM
 * import/export. React Native has no DOM, no `react-grid-layout`, no
 * `localStorage`, no `BroadcastChannel`, and no `<a download>` / `Blob` /
 * `File` APIs, so the browser-only seams are replaced with native-safe
 * equivalents while every other line of logic, every state name, every API
 * path, and the unit/i18n intent are preserved verbatim.
 *
 * Browser-only seams replaced (see the file's `.parity.json` sidecar):
 *   • `react-grid-layout` `verticalCompactor` → faithful inline port of the
 *     v2.2.3 `src/core/compactors.ts` vertical compactor (+ its collision /
 *     sort / clone helpers). Pure layout math, no DOM.
 *   • `localStorage` → `webParityStorage`, a synchronous in-memory shim that
 *     mirrors the `getItem`/`setItem`/`removeItem` surface so the hook keeps
 *     its synchronous read/write flow. UNAVAILABLE: persistence across app
 *     launches — the backend (`useDashboardLayouts` / `useSaveDashboardLayouts`)
 *     remains the durable source of truth and re-hydrates on mount.
 *   • `@/lib/broadcast` `broadcast` / `subscribe` → an in-process bus tagged
 *     with a stable `NATIVE_TAB_ID` and self-filtering, exactly like the web
 *     bus. On single-process native there is only ever the "current tab", so
 *     self-messages are dropped and the bus is inert by design — identical to
 *     a lone browser tab. UNAVAILABLE: live cross-window sync.
 *   • `../widgets/types` → inlined type definitions.
 *   • `../widgets/registry` → inlined size-only metadata registry. The hook
 *     only reads `id` + `defaultSize`/`minSize`/`maxSize` for layout math, so
 *     the native registry is the size projection of the web `WidgetDef`
 *     (no lucide icons, no lazy components).
 *   • `./useUndoRedo` → inlined faithful port.
 *   • Export (`Blob` + `URL.createObjectURL` + `<a download>`) → serialized
 *     JSON is recorded in `lastNativeDashboardExport` for a future native
 *     share-sheet / document-writer to consume. UNAVAILABLE: direct download.
 *   • Import DOM `File` → `DashboardImportFile { text(): Promise<string> }` so
 *     a native document-picker result can be passed without a DOM dependency.
 */

import {useState, useCallback, useMemo, useRef, useEffect} from 'react';

import {
  useDashboardLayouts,
  useSaveDashboardLayouts,
} from '../../../api/hooks/useSettings';
import type {DashboardLayoutsPayload} from '../../../api/hooks/useSettings';

/* ─── Inlined widget types (web/src/features/dashboard/widgets/types.ts) ─── */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

/** react-grid-layout Layout item (position + size in grid units) */
export interface RGLLayout {
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

/** react-grid-layout Layouts — keyed by breakpoint string */
export interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

export interface DashboardSettings {
  /** Auto-refresh interval in seconds (0 = use per-widget default) */
  refreshInterval: number;
  /** Filter widgets to show only this vehicle (undefined = all vehicles) */
  vehicleId?: number;
  /** Show widget borders in view mode */
  showWidgetBorders: boolean;
  /** Compact mode — reduces grid gaps */
  compactMode: boolean;
}

export interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  /**
   * Optional per-vehicle scope.
   *   undefined / null → applies to ALL vehicles ("user-global").
   *   number           → pinned to that vehicle id; switcher hides this
   *                      layout when a different vehicle is selected.
   */
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  settings?: DashboardSettings;
}

/** @deprecated Use SavedDashboard instead. Kept for migration. */
export interface LegacyDashboardLayout {
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

/* ─── Inlined size-only widget registry (web .../widgets/registry) ─── */
// The hook only consumes a widget's id + default/min/max grid sizes for
// layout math (placement, clamping, reconciliation). The native registry is
// therefore the size projection of the web `WidgetDef` — no lucide icons and
// no lazy React components, which are DOM/bundle concerns irrelevant here.
// Mirrors all 118 widget definitions across the 16 web registry category
// files verbatim.
interface WidgetSizeDef {
  id: string;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
}

const WIDGET_REGISTRY: WidgetSizeDef[] = [
  { id: 'vehicle-hero', defaultSize: { cols: 2, rows: 9 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'vehicle-hero-card', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'vehicle-twin', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'digital-twin-mini', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'software-update-status', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'software-update-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'odometer-counter', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 2, rows: 40 } },
  { id: 'drivetrain-health', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'motor-performance', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'motor-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'vehicle-specs', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'watch-summary', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 2, rows: 40 } },
  { id: 'maintenance-tracker', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'warranty-status', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'subscriptions', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'vehicle-upgrades', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'battery-gauge', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 2, rows: 40 } },
  { id: 'battery-radial-gauge', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'range-estimate', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 2, rows: 40 } },
  { id: 'range-bar', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'battery-degradation-trend', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'energy-flow', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'projected-range', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'battery-cells', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'battery-degradation-forecast', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'battery-health-analytics', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'energy-flow-animated', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'vampire-drain', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'sleep-efficiency', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'solar-production', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'live-power-flow', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'energy-site-info', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'backup-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'power-flow-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'energy-stats', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'recent-drives', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'drive-score', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 2, rows: 40 } },
  { id: 'recent-drives-list', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'drive-score-gauge', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 2, rows: 40 } },
  { id: 'drive-efficiency-chart', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'speed-heatmap', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'driving-dynamics', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'speed-profile', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'regen-efficiency', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'route-efficiency', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'driving-coach', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'trip-summary', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'drive-telemetry', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'charge-status', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'charge-status-live', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'charge-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'charge-session-chart', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'charge-cost-tracker', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'charging-schedule', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'cost-forecast', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'charging-optimizer', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'wall-connector', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'charging-telemetry', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'supercharger-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'charge-plans', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'charging-session-detail', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'climate-status', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 2, rows: 40 } },
  { id: 'climate-control-panel', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'weather-at-car', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'climate-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'tire-pressure-visual', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'tire-pressure-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'security-status', defaultSize: { cols: 1, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 2, rows: 40 } },
  { id: 'door-window-status', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'sentry-event-log', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'safety-features', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'safety-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'guard-mode', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'vehicle-access', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'command-quick-actions', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'command-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'media-now-playing', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'media-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'live-signals', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'live-signal-sparklines', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'signal-health', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'signal-catalog', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'signal-log', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'fleet-stats', defaultSize: { cols: 4, rows: 2 }, minSize: { cols: 2, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'fleet-stats-bar', defaultSize: { cols: 4, rows: 2 }, minSize: { cols: 3, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'weekly-summary-card', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'weekly-digest', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'monthly-mileage', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'lifetime-stats', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'mileage-stats', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'state-timeline', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'anomaly-detector', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'fsm-distribution', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'cost-breakdown', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'year-review', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'analytics-summary', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'recently-unlocked-achievements', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 4 } },
  { id: 'alert-feed', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'notification-stats', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'automation-status', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'automation-history', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'onboarding-checklist', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 3 }, maxSize: { cols: 4, rows: 8 } },
  { id: 'uptime-monitor', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'mqtt-status', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'quick-nav', defaultSize: { cols: 4, rows: 2 }, minSize: { cols: 2, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'api-usage', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'system-health', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'telemetry-errors', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'audit-log', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'backup-monitor', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'export-status', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'version-info', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'dashboard-stats', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'location-map', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'location-favorites', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'geofence-status', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 4, rows: 40 } },
  { id: 'destination-eta', defaultSize: { cols: 2, rows: 2 }, minSize: { cols: 1, rows: 2 }, maxSize: { cols: 3, rows: 40 } },
  { id: 'position-heatmap', defaultSize: { cols: 2, rows: 4 }, minSize: { cols: 2, rows: 4 }, maxSize: { cols: 4, rows: 40 } },
];

function getWidgetDef(widgetId: string): WidgetSizeDef | undefined {
  return WIDGET_REGISTRY.find(w => w.id === widgetId);
}

/* ─── Inlined react-grid-layout vertical compactor (v2.2.3 core) ─── */
// Faithful port of the pure layout math from react-grid-layout@2.2.3
// `src/core/{compactors,collision,sort,layout}.ts`. No DOM, no React. Slides
// items up to fill `y` gaps; preserves user-resized `w`/`h` and original item
// order; sets `moved: false` on each processed item — identical semantics to
// the library so persisted/compacted layouts match the web byte-for-byte.

function collides(l1: RGLLayout, l2: RGLLayout): boolean {
  if (l1.i === l2.i) return false; // same element — can't collide with itself
  if (l1.x + l1.w <= l2.x) return false; // l1 is completely left of l2
  if (l1.x >= l2.x + l2.w) return false; // l1 is completely right of l2
  if (l1.y + l1.h <= l2.y) return false; // l1 is completely above l2
  if (l1.y >= l2.y + l2.h) return false; // l1 is completely below l2
  return true; // bounding boxes overlap
}

function getFirstCollision(
  layout: RGLLayout[],
  item: RGLLayout,
): RGLLayout | undefined {
  for (let i = 0; i < layout.length; i++) {
    if (collides(layout[i], item)) return layout[i];
  }
  return undefined;
}

function bottom(layout: RGLLayout[]): number {
  let max = 0;
  for (let i = 0; i < layout.length; i++) {
    const bottomY = layout[i].y + layout[i].h;
    if (bottomY > max) max = bottomY;
  }
  return max;
}

function getStatics(layout: RGLLayout[]): RGLLayout[] {
  return layout.filter(l => l.static === true);
}

function sortLayoutItemsByRowCol(layout: RGLLayout[]): RGLLayout[] {
  return [...layout].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y; // primary sort by row (y)
    return a.x - b.x; // secondary sort by column (x)
  });
}

function cloneLayoutItem(item: RGLLayout): RGLLayout {
  return {
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    maxW: item.maxW,
    minH: item.minH,
    maxH: item.maxH,
    moved: Boolean(item.moved),
    static: Boolean(item.static),
    isDraggable: item.isDraggable,
    isResizable: item.isResizable,
  };
}

function resolveCompactionCollision(
  layout: RGLLayout[],
  item: RGLLayout,
  moveToCoord: number,
  axis: 'x' | 'y',
): void {
  const sizeProp = axis === 'x' ? 'w' : 'h';
  // Temporarily increment position to check for collisions
  item[axis] += 1;
  const itemIndex = layout.findIndex(l => l.i === item.i);

  for (let i = itemIndex + 1; i < layout.length; i++) {
    const otherItem = layout[i];
    if (otherItem.static) continue;
    // Optimization: break early once past this element. Native layouts never
    // contain static items, so sort order guarantees no further collisions.
    if (otherItem.y > item.y + item.h) break;

    if (collides(item, otherItem)) {
      resolveCompactionCollision(
        layout,
        otherItem,
        moveToCoord + item[sizeProp],
        axis,
      );
    }
  }

  item[axis] = moveToCoord;
}

function compactItemVertical(
  compareWith: RGLLayout[],
  l: RGLLayout,
  fullLayout: RGLLayout[],
  maxY: number,
): RGLLayout {
  // Correct negative positions first
  l.x = Math.max(l.x, 0);
  l.y = Math.max(l.y, 0);
  // Limit Y to the current bottom
  l.y = Math.min(maxY, l.y);

  // Move up as far as possible
  while (l.y > 0 && getFirstCollision(compareWith, l) === undefined) {
    l.y--;
  }

  // Resolve collisions by moving down
  let collision: RGLLayout | undefined;
  while ((collision = getFirstCollision(compareWith, l)) !== undefined) {
    resolveCompactionCollision(fullLayout, l, collision.y + collision.h, 'y');
  }

  l.y = Math.max(l.y, 0);
  return l;
}

const verticalCompactor = {
  compact(layout: RGLLayout[], _cols: number): RGLLayout[] {
    const compareWith = getStatics(layout);
    let maxY = bottom(compareWith);
    const sorted = sortLayoutItemsByRowCol(layout);
    const out: RGLLayout[] = new Array(layout.length);

    for (let i = 0; i < sorted.length; i++) {
      const sortedItem = sorted[i];
      let l = cloneLayoutItem(sortedItem);

      if (!l.static) {
        l = compactItemVertical(compareWith, l, sorted, maxY);
        maxY = Math.max(maxY, l.y + l.h);
        compareWith.push(l);
      }

      const originalIndex = layout.indexOf(sortedItem);
      out[originalIndex] = l;
      l.moved = false;
    }

    return out;
  },
};

/* ─── Inlined undo/redo history (web .../hooks/useUndoRedo.ts) ─── */

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

/**
 * Generic undo/redo history hook.
 * Uses refs for stacks so undo/redo return the new value synchronously,
 * with a version counter to trigger re-renders.
 */
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
    if (previous === undefined) return undefined;
    redoStack.current.push(currentRef.current);
    currentRef.current = previous;
    forceRender(v => v + 1);
    return previous;
  }, []);

  const redo = useCallback((): T | undefined => {
    const next = redoStack.current.pop();
    if (next === undefined) return undefined;
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

/* ─── Native-safe localStorage shim (in-memory, synchronous) ─── */
// Mirrors the `localStorage` surface the hook depends on so its synchronous
// read/write flow is preserved verbatim. Backed by an in-process Map: the
// backend (useDashboardLayouts / useSaveDashboardLayouts) is the durable
// source of truth and re-hydrates this cache on mount. UNAVAILABLE on native:
// persistence across cold app launches.
const nativeMemoryStore = new Map<string, string>();
const webParityStorage = {
  getItem(key: string): string | null {
    return nativeMemoryStore.has(key) ? (nativeMemoryStore.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    nativeMemoryStore.set(key, value);
  },
  removeItem(key: string): void {
    nativeMemoryStore.delete(key);
  },
};

/* ─── Native-safe cross-tab bus (web .../lib/broadcast.ts) ─── */
// In-process pub/sub tagged with a stable per-process id and self-filtering,
// exactly like the web BroadcastChannel bus. On single-process native there is
// only the "current tab", so every message is dropped as a self-message and
// the bus is inert by design — identical behavior to a lone browser tab.
// UNAVAILABLE on native: live cross-window/instance sync.
interface DashboardBroadcastMessage {
  type: string;
}
interface BroadcastEnvelope {
  _from: string;
  msg: DashboardBroadcastMessage;
}

const NATIVE_TAB_ID = `native-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const broadcastListeners = new Set<(env: BroadcastEnvelope) => void>();

function broadcast(msg: DashboardBroadcastMessage): void {
  const envelope: BroadcastEnvelope = {_from: NATIVE_TAB_ID, msg};
  broadcastListeners.forEach(listener => {
    listener(envelope);
  });
}

function subscribe(handler: (msg: DashboardBroadcastMessage) => void): () => void {
  const listener = (envelope: BroadcastEnvelope) => {
    if (envelope._from === NATIVE_TAB_ID) return; // drop self — matches web bus
    try {
      handler(envelope.msg);
    } catch {
      // Subscriber threw — never let one consumer crash the bus.
    }
  };
  broadcastListeners.add(listener);
  return () => {
    broadcastListeners.delete(listener);
  };
}

/* ─── Native-safe dashboard import/export seams ─── */
/** Minimal file-like contract for native document-picker results. */
export interface DashboardImportFile {
  text(): Promise<string>;
}

/** Serialized export captured for a future native share-sheet / file writer. */
export interface NativeDashboardExport {
  filename: string;
  json: string;
}

let lastNativeDashboardExport: NativeDashboardExport | null = null;

/** The most recent {@link exportDashboard} payload, or null if none yet. */
export function getLastNativeDashboardExport(): NativeDashboardExport | null {
  return lastNativeDashboardExport;
}

/** Capability flags for the native dashboard-layout hook. */
export const nativeDashboardLayoutCapabilities = {
  // localStorage replaced by an in-memory shim (no cold-launch persistence).
  localPersistenceDurable: false,
  // Single-process native: cross-tab/window sync is inert by design.
  crossTabSyncAvailable: false,
  // DOM download replaced by an in-memory export sink.
  fileDownloadAvailable: false,
  // Backend sync (TanStack Query) remains the durable source of truth.
  backendSyncAvailable: true,
} as const;

const DASHBOARDS_KEY = 'teslasync-dashboards';
const ACTIVE_KEY = 'teslasync-active-dashboard';
const LEGACY_KEY = 'teslasync-dashboard-layout';
const WIDGET_REGISTRY_IDS = new Set(WIDGET_REGISTRY.map(w => w.id));

/* ─── Breakpoint constants ─── */
export const GRID_BREAKPOINTS = {lg: 1200, md: 996, sm: 768, xs: 480} as const;
export const GRID_COLS = {lg: 4, md: 3, sm: 2, xs: 1} as const;
export const ROW_HEIGHT = 80;
export const GRID_MARGIN: [number, number] = [16, 16];

/* ─── Undo/Redo snapshot ─── */
interface DashboardSnapshot {
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
}

/* ─── Helpers ─── */
let nextId = Date.now();
function generateId(): string {
  return `w-${++nextId}`;
}

function clampMinMax(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Build RGL Layout item from a WidgetInstance + its WidgetDef, at column x */
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

/** Build multi-breakpoint Layouts from a widget list (auto-flow placement) */
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

/** Guard against corrupt layout data (NaN, 0, undefined) from storage */
function sanitizeLayouts(layouts: RGLLayouts): RGLLayouts {
  const result: RGLLayouts = {};
  for (const [bp, items] of Object.entries(layouts)) {
    result[bp] = (items as RGLLayout[]).map(item => ({
      ...item,
      w: Math.max(Number.isFinite(item.w) ? item.w : 1, 1),
      h: Math.max(Number.isFinite(item.h) ? item.h : 1, 1),
      x: Math.max(Number.isFinite(item.x) ? item.x : 0, 0),
      y: Math.max(Number.isFinite(item.y) ? item.y : 0, 0),
    }));
  }
  return result;
}

/**
 * Apply vertical compaction to every breakpoint's layout — slide items up
 * to fill `y` gaps left behind by widget removal, add-after-remove, or
 * other historical edits. Preserves user-resized `w`/`h` and relative
 * order (compactor only changes `y`, not size).
 *
 * Required because react-grid-layout v2 `findOrGenerateResponsiveLayout`
 * EARLY-RETURNS a clone of the saved layout for the current breakpoint
 * WITHOUT applying the compactor. So unless we canonicalize gaps out at the
 * data layer, removed-widget holes survive across reloads forever and the
 * dashboard accumulates blank vertical space over the life of the user's
 * saved layout.
 */
function compactLayouts(layouts: RGLLayouts): RGLLayouts {
  const result: RGLLayouts = {};
  for (const [bp, items] of Object.entries(layouts)) {
    const cols = GRID_COLS[bp as keyof typeof GRID_COLS];
    if (cols === undefined || items.length === 0) {
      result[bp] = items as RGLLayout[];
      continue;
    }
    // verticalCompactor.compact returns a fresh array with each item's `y`
    // squashed up against the floor + previously placed items in its column
    // range. It also sets `moved: false` on each item it processed.
    result[bp] = verticalCompactor.compact(items as RGLLayout[], cols);
  }
  return result;
}

/** Ensure layout has valid items for all widgets and respects current constraints */
export function reconcileLayouts(
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
        // Preserve user-saved sizes — only enforce min/max from registry
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
    // Remove stale widget references
    result[bp] = items.filter(item => widgetIds.has(item.i));
  }
  // Slide items up to fill gaps left by removed widgets, add-after-remove,
  // or historical resize-up edits. Without this any code path that flows
  // through reconcileLayouts would let `y` gaps accumulate indefinitely —
  // RGL v2 does not compact existing saved breakpoint layouts at mount.
  return compactLayouts(result);
}

/* ─── Default / Preset dashboards ─── */
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
    // Include the onboarding checklist by default for new users so they
    // have a clear path through first-run setup. The widget
    // self-hides once dismissed or the celebration window after 100 % expires.
    // Existing users with persisted layouts are unaffected (their layouts
    // hydrate from backend / storage and bypass this default seed).
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

export const DASHBOARD_PRESETS: SavedDashboard[] = [
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

/* ─── Migration from legacy format ─── */
function migrateLegacy(legacy: LegacyDashboardLayout): SavedDashboard {
  const widgets: WidgetInstance[] = legacy.widgets
    .filter(w => WIDGET_REGISTRY.some(def => def.id === w.widgetId))
    .map(w => ({
      id: w.id,
      widgetId: w.widgetId,
      config: w.config as WidgetConfig | undefined,
    }));

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

/* ─── Row height migration ─── */
const ROW_HEIGHT_VERSION_KEY = 'teslasync-row-height-version';
const CURRENT_ROW_VERSION = 2; // v1=180px, v2=80px

function migrateRowHeight(dashboards: SavedDashboard[]): SavedDashboard[] {
  const savedVersion = parseInt(
    webParityStorage.getItem(ROW_HEIGHT_VERSION_KEY) ?? '1',
    10,
  );
  if (savedVersion >= CURRENT_ROW_VERSION) return dashboards;

  // Scale factor: old ROW_HEIGHT / new ROW_HEIGHT = 180/80 = 2.25
  const scale = 2.25;
  const migrated = dashboards.map(d => ({
    ...d,
    layouts: Object.fromEntries(
      Object.entries(d.layouts).map(([bp, items]) => [
        bp,
        (items as RGLLayout[]).map(item => ({
          ...item,
          h: Math.max(Math.round(item.h * scale), 2),
          y: Math.round(item.y * scale),
          minH: item.minH ? Math.max(Math.round(item.minH * scale), 2) : undefined,
          maxH: item.maxH ? Math.round(item.maxH * scale) : undefined,
        })),
      ]),
    ) as RGLLayouts,
  }));

  webParityStorage.setItem(ROW_HEIGHT_VERSION_KEY, String(CURRENT_ROW_VERSION));
  webParityStorage.setItem(DASHBOARDS_KEY, JSON.stringify(migrated));
  return migrated;
}

/* ─── Load from storage with migration ─── */
function loadDashboards(): SavedDashboard[] {
  try {
    const stored = webParityStorage.getItem(DASHBOARDS_KEY);
    if (stored) {
      let parsed = JSON.parse(stored) as SavedDashboard[];
      // Migrate row heights from old ROW_HEIGHT=180 to new ROW_HEIGHT=80
      parsed = migrateRowHeight(parsed);
      // Reconcile widgets against current registry
      return parsed.map(d => ({
        ...d,
        widgets: d.widgets.filter(w =>
          WIDGET_REGISTRY.some(def => def.id === w.widgetId),
        ),
        layouts: sanitizeLayouts(
          reconcileLayouts(
            d.layouts ?? {},
            d.widgets.filter(w =>
              WIDGET_REGISTRY.some(def => def.id === w.widgetId),
            ),
          ),
        ),
      }));
    }
    // Try legacy migration
    const legacy = webParityStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as LegacyDashboardLayout;
      const migrated = migrateLegacy(parsed);
      const dashboards = [migrated];
      webParityStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dashboards));
      webParityStorage.removeItem(LEGACY_KEY);
      return dashboards;
    }
  } catch {
    // Fall through to default
  }
  return [{...DEFAULT_DASHBOARD}];
}

function loadActiveId(): string {
  try {
    return webParityStorage.getItem(ACTIVE_KEY) ?? 'default';
  } catch {
    return 'default';
  }
}

/** Returns true if storage contains only the default dashboard (no custom data). */
function isLocalStorageDefaultOnly(): boolean {
  try {
    const raw = webParityStorage.getItem(DASHBOARDS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as SavedDashboard[];
    return parsed.length <= 1 && parsed[0]?.id === 'default';
  } catch {
    return true;
  }
}

/* ─── Hook ─── */
export function useDashboardLayout() {
  const [dashboards, setDashboards] = useState<SavedDashboard[]>(loadDashboards);
  const [activeId, setActiveId] = useState<string>(loadActiveId);
  const [editMode, setEditMode] = useState(false);
  const [hydratedFromBackend, setHydratedFromBackend] = useState(false);

  /* ─── Backend sync hooks ─── */
  const {data: backendLayouts} = useDashboardLayouts();
  const saveMutation = useSaveDashboardLayouts();

  /* ─── Debounced backend write ─── */
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dirty, setDirty] = useState(false);
  const syncToBackend = useCallback(
    (dbs: SavedDashboard[], active: string) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
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

  /* ─── Hydrate from backend on first load ─── */
  useEffect(() => {
    if (hydratedFromBackend || !backendLayouts) return;
    setHydratedFromBackend(true);

    const hasBackendData =
      Array.isArray(backendLayouts.dashboards) &&
      backendLayouts.dashboards.length > 0;
    if (!hasBackendData) return;

    // Only hydrate if storage has no custom data (default-only or empty)
    if (!isLocalStorageDefaultOnly()) return;

    // Use backend data — user switched device or cleared local cache
    const restored = backendLayouts.dashboards as SavedDashboard[];
    const restoredActiveId = backendLayouts.active_id || 'default';

    // Reconcile restored dashboards against current widget registry
    const reconciled = restored.map(d => {
      const validWidgets = (d.widgets ?? []).filter(w =>
        WIDGET_REGISTRY.some(def => def.id === w.widgetId),
      );
      return {
        ...d,
        widgets: validWidgets,
        layouts: sanitizeLayouts(
          reconcileLayouts(d.layouts ?? {}, validWidgets),
        ),
      };
    });

    if (reconciled.length === 0) return;

    setDashboards(reconciled);
    webParityStorage.setItem(DASHBOARDS_KEY, JSON.stringify(reconciled));
    const finalActiveId = reconciled.some(d => d.id === restoredActiveId)
      ? restoredActiveId
      : reconciled[0].id;
    setActiveId(finalActiveId);
    webParityStorage.setItem(ACTIVE_KEY, finalActiveId);
  }, [backendLayouts, hydratedFromBackend]);

  /* ─── Cross-tab sync ─── */
  // When another tab mutates the dashboard layout, re-read from storage so
  // this tab's React state reflects the change. The sibling tab already wrote
  // the new snapshot via persist/updateActive. On single-process native this
  // bus is inert (no peer tabs), so the handler never fires.
  useEffect(() => {
    return subscribe(m => {
      if (m.type !== 'dashboard.layout') return;
      try {
        const raw = webParityStorage.getItem(DASHBOARDS_KEY);
        if (raw) setDashboards(JSON.parse(raw) as SavedDashboard[]);
        const active = webParityStorage.getItem(ACTIVE_KEY);
        if (active) setActiveId(active);
      } catch {
        /* ignore malformed peer write */
      }
    });
  }, []);

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

  /* ─── Undo/Redo history ─── */
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

  /* ─── Persistence ─── */
  const persist = useCallback(
    (dbs: SavedDashboard[], active?: string) => {
      setDashboards(dbs);
      webParityStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dbs));
      const resolvedActive = active !== undefined ? active : activeId;
      if (active !== undefined) {
        setActiveId(active);
        webParityStorage.setItem(ACTIVE_KEY, active);
      }
      syncToBackend(dbs, resolvedActive);
      // Let other tabs reload their layout state from the freshly-written
      // storage snapshot.
      broadcast({type: 'dashboard.layout'});
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
        webParityStorage.setItem(DASHBOARDS_KEY, JSON.stringify(updated));
        syncToBackend(updated, activeId);
        broadcast({type: 'dashboard.layout'});
        return updated;
      });
    },
    [activeId, syncToBackend],
  );

  /* ─── Layout actions ─── */
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
        if (existingWidgetIds.has(widgetId) || !WIDGET_REGISTRY_IDS.has(widgetId))
          continue;
        existingWidgetIds.add(widgetId);
        newWidgets.push({
          id: generateId(),
          widgetId,
        });
      }

      if (newWidgets.length === 0) return;

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

  /* ─── Dashboard CRUD ─── */
  const switchDashboard = useCallback(
    (id: string) => {
      setActiveId(id);
      webParityStorage.setItem(ACTIVE_KEY, id);
      const dash = dashboardsRef.current.find(d => d.id === id);
      if (dash) resetSnapshot({widgets: dash.widgets, layouts: dash.layouts});
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
      if (!target || target.isDefault) return;
      const remaining = dashboards.filter(d => d.id !== id);
      if (remaining.length === 0) return;
      const nextActive =
        id === activeId
          ? remaining.find(d => d.isDefault)?.id ?? remaining[0].id
          : activeId;
      persist(remaining, nextActive);
      if (id === activeId) {
        const nextDash = remaining.find(d => d.id === nextActive);
        if (nextDash)
          resetSnapshot({widgets: nextDash.widgets, layouts: nextDash.layouts});
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
        webParityStorage.setItem(DASHBOARDS_KEY, JSON.stringify(result));
        syncToBackend(result, activeId);
        return result;
      });
    },
    [activeId, syncToBackend],
  );

  const duplicateDashboard = useCallback(
    (id: string) => {
      const source = dashboards.find(d => d.id === id);
      if (!source) return;

      const newId = `dup-${Date.now()}`;
      // Build a mapping from old widget IDs to new ones
      const idMap = new Map<string, string>();
      const widgets = source.widgets.map(w => {
        const newWidgetId = generateId();
        idMap.set(w.id, newWidgetId);
        return {...w, id: newWidgetId};
      });

      // Remap layout item `i` values to match new widget IDs
      const remappedLayouts: RGLLayouts = {};
      for (const [bp, items] of Object.entries(source.layouts)) {
        remappedLayouts[bp] = (items as RGLLayout[]).map(item => ({
          ...item,
          i: idMap.get(item.i) ?? item.i,
        }));
      }
      // Reconcile (which now also compacts) so a duplicate of a dashboard
      // that had accumulated gaps comes back clean — and re-clamps to the
      // current registry min/max in case the source was old.
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
          d.id === id ? {...d, settings, updatedAt: new Date().toISOString()} : d,
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
      if (!preset) return;
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

  /* ─── Import / Export ─── */
  // Web triggered a browser file download via Blob + URL.createObjectURL +
  // <a download>. React Native has no DOM, so the serialized payload is
  // captured in `lastNativeDashboardExport` for a future native share-sheet /
  // document-writer to consume. The serialization itself is identical.
  const exportDashboard = useCallback(
    (id?: string) => {
      const dash = dashboards.find(d => d.id === (id ?? activeId));
      if (!dash) return;
      const json = JSON.stringify(dash, null, 2);
      const filename = `teslasync-dashboard-${dash.name
        .toLowerCase()
        .replace(/\s+/g, '-')}.json`;
      lastNativeDashboardExport = {filename, json};
    },
    [dashboards, activeId],
  );

  const importDashboard = useCallback(
    async (file: DashboardImportFile) => {
      const text = await file.text();
      const parsed = JSON.parse(text) as SavedDashboard;
      if (!parsed.name || !parsed.widgets || !parsed.layouts) {
        throw new Error('Invalid layout file');
      }
      // Assign new ID, filter unknown widgets, reconcile layouts
      const id = `import-${Date.now()}`;
      const widgets = (parsed.widgets ?? []).filter(w =>
        WIDGET_REGISTRY.some(def => def.id === w.widgetId),
      );
      const newDash: SavedDashboard = {
        ...parsed,
        id,
        widgets,
        layouts: reconcileLayouts(parsed.layouts, widgets),
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persist([...dashboards, newDash], id);
      resetSnapshot({widgets: newDash.widgets, layouts: newDash.layouts});
    },
    [dashboards, persist, resetSnapshot],
  );

  /** Import a pre-validated SavedDashboard directly (used by ImportPreviewModal) */
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

  /* ─── Auto arrange ─── */
  const autoArrange = useCallback(() => {
    const current = activeDashRef.current;
    const layouts = buildDefaultLayouts(current.widgets);
    pushSnapshot({widgets: current.widgets, layouts});
    updateActive(d => ({...d, layouts}));
  }, [updateActive, pushSnapshot]);

  /** Get the current widget size from the lg layout (for passing to widgets) */
  const getWidgetSize = useCallback(
    (instanceId: string): {cols: number; rows: number} => {
      const lgLayout: RGLLayout[] = activeDashboard.layouts.lg ?? [];
      const item = lgLayout.find((l: RGLLayout) => l.i === instanceId);
      if (item) return {cols: item.w, rows: item.h};
      const widget = activeDashboard.widgets.find(w => w.id === instanceId);
      const def = widget ? getWidgetDef(widget.widgetId) : undefined;
      return def?.defaultSize ?? {cols: 1, rows: 1};
    },
    [activeDashboard],
  );

  /* ─── Undo / Redo ─── */
  // Run restored snapshots through reconcileLayouts so they get re-clamped
  // to the current registry min/max AND vertically compacted — matches the
  // canonical layout invariant the rest of the app maintains. Without this
  // an undo/redo could resurface a pre-fix layout with accumulated gaps.
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
            ? {...d, vehicleId: vehicleId ?? null, updatedAt: new Date().toISOString()}
            : d,
        ),
      );
    },
    [dashboards, persist],
  );

  /**
   * Filter dashboards visible for a given vehicle id. A dashboard is visible
   * when it has no vehicle scope (user-global) OR is pinned to the active
   * vehicle. Pass `null`/`undefined` to see only user-global dashboards.
   */
  const visibleFor = useCallback(
    (vehicleId: number | null | undefined): SavedDashboard[] => {
      return dashboards.filter(d => {
        const scope = d.vehicleId;
        if (scope == null) return true;
        return vehicleId != null && scope === vehicleId;
      });
    },
    [dashboards],
  );

  return {
    // Multi-dashboard
    dashboards,
    activeDashboard,
    activeId,
    visibleFor,
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
    // Edit mode
    editMode,
    setEditMode,
    // Unsaved-changes badge — true while a backend write is debounced/in flight.
    dirty,
    // Widget CRUD
    addWidget,
    addWidgets,
    removeWidget,
    updateWidgetConfig,
    // Layout
    updateLayouts,
    autoArrange,
    getWidgetSize,
    // Import / Export
    exportDashboard,
    importDashboard,
    importDashboardFromData,
    // Undo / Redo
    canUndo,
    canRedo,
    undoCount,
    undo,
    redo,
  };
}
