import type { LucideIcon } from 'lucide-react';
import type { LazyExoticComponent, ComponentType } from 'react';

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
  icon: LucideIcon;
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
