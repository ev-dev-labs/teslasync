// Native parity port of web/src/features/dashboard/widgets/types.ts.
//
// Pure TypeScript type definitions for the dashboard widget registry (widget
// metadata, grid sizing, persisted layouts, and saved-dashboard documents).
// There is no runtime behavior here, so every interface/type is ported
// field-for-field. Only the two web-React-specific imports are adapted for
// native:
//
//   * `import type { LucideIcon } from 'lucide-react'` (L1) is a DOM/SVG icon
//     component type and is NOT native-safe, so it is dropped. Native renders
//     icons through the repo SemanticIcon system, so `WidgetDef.icon` is retyped
//     from `LucideIcon` to `SemanticIconName` (type-only import — no runtime
//     coupling). This matches the existing native widget-registry ports
//     (registry/security.ts, registry/charging.ts) that already mirror this
//     field as `SemanticIconName`.
//   * `import type { LazyExoticComponent, ComponentType } from 'react'` (L2) is
//     kept verbatim: React.lazy and these type helpers are native-safe (Metro
//     supports code-split lazy widgets), so `WidgetDef.component` keeps its
//     `LazyExoticComponent<ComponentType<WidgetProps>>` shape.
//
// `RGLLayout`/`RGLLayouts` describe react-grid-layout's persisted position+size
// items. They are plain serializable data shapes (stored inside
// `SavedDashboard.layouts` and round-tripped through import/export), not RGL
// runtime, so they are ported verbatim and remain fully native-safe.
//
// No DOM, no lucide-react, no Recharts/Leaflet, and no web UI components are
// imported — only the native-safe React type helpers plus a type-only
// SemanticIconName import.

import type { LazyExoticComponent, ComponentType } from 'react';

import type { SemanticIconName } from '../../../../components/icons/SemanticIcon';

/**
 * Metadata describing a widget's contextual help.
 *
 * Use `i18nKey` (with `defaultValue`) for new widgets so help text is
 * translated; `text` is supported for legacy/static strings. `learnMore`
 * adds a "Learn more" link in the tooltip body that opens in a new tab.
 *
 * Dashboard widget registry types.
 */
export interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: { url: string; label?: string };
}

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

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

export type WidgetCategory =
  | 'vehicle'
  | 'battery'
  | 'energy'
  | 'driving'
  | 'charging'
  | 'climate'
  | 'tires'
  | 'security'
  | 'commands'
  | 'media'
  | 'telemetry'
  | 'analytics'
  | 'alerts'
  | 'automations'
  | 'system'
  | 'maps';

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  // Web: `icon: LucideIcon` (lucide-react DOM/SVG component). Native renders
  // icons via <SemanticIcon name={icon} />, so the field is retyped to the repo
  // SemanticIconName string union.
  icon: SemanticIconName;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
  /**
   * Optional help metadata. When set, forward this to `WidgetShell`'s `help`
   * prop so a "?" tooltip appears next to the widget title.
   */
  help?: WidgetHelp;
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

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  refreshInterval: 0,
  showWidgetBorders: false,
  compactMode: false,
};

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
