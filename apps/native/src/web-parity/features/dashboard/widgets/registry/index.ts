// Native parity port of
// web/src/features/dashboard/widgets/registry/index.ts.
//
// The web module is the dashboard widget-registry aggregator. It (1) imports the
// 16 per-category widget slices (VEHICLE_WIDGETS … MAP_WIDGETS), (2) flattens
// them — in source order — into a single `WIDGET_REGISTRY: WidgetDef[]`,
// (3) exposes `getWidgetDef(widgetId)` which looks a widget up by `id`, and
// (4) re-exports all 16 slice arrays. This port preserves that exact public
// surface and the exact spread/lookup behaviour (web L20-60).
//
// Conversion-order constraint (file-by-file loop): only the analytics slice has
// been ported to native so far (registry/analytics.ts → ANALYTICS_WIDGETS); it
// is imported and aggregated for real (web L14 / L32 / L55). The other 15
// sibling registry modules (./vehicle, ./battery, ./energy, ./driving,
// ./charging, ./climate, ./tires, ./security, ./commands, ./media, ./telemetry,
// ./alerts, ./automations, ./system, ./maps — web L3-13, L15-18) are not yet
// present under web-parity, and statically importing a non-existent module would
// break `tsc --noEmit`. Each is therefore declared as a native-safe, empty
// `WidgetDef[]` placeholder — the explicit "unavailable" state for a slice whose
// widgets are not yet available on native. The aggregation shape, source
// ordering, and all 16 named re-exports stay intact; as each sibling registry
// file is ported in the loop, its placeholder is replaced by the real
// `import { X_WIDGETS } from './x'`.
//
// `WidgetDef` (+ its WidgetSize / WidgetConfig / WidgetProps / WidgetCategory
// dependencies) comes from web ../types (web L1), which is out of this slice, so
// it is inlined below as module-local declarations — the same approach used by
// the ported registry/analytics.ts and hooks/validateImport.ts. `icon` is
// re-typed from lucide-react's `LucideIcon` to the native `SemanticIconName`
// vocabulary so the inlined `WidgetDef` is structurally identical to
// registry/analytics.ts's, and the real `ANALYTICS_WIDGETS` flows into
// `WIDGET_REGISTRY` via structural typing.

import type { ComponentType, LazyExoticComponent } from 'react';

import type { SemanticIconName } from '../../../../../components/icons/SemanticIcon';
import { ANALYTICS_WIDGETS } from './analytics';

/* ─── inlined widget registry types (web ../types) ─────────────────────────── */

interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
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

type WidgetCategory =
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

interface WidgetDef {
  id: string;
  name: string;
  description: string;
  // Web: `icon: LucideIcon`. lucide-react has no native renderer, so the icon
  // is carried as the equivalent native SemanticIcon name (matches analytics.ts).
  icon: SemanticIconName;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
}

/* ─── not-yet-ported sibling slices (native-safe empty placeholders) ────────── */
// Replaced by the real `import { X_WIDGETS } from './x'` as each sibling registry
// file is converted in the file-by-file loop. Empty = no widgets from this
// category are available on native yet (explicit unavailable state). Names and
// source ordering mirror web L3-18 exactly (note the singular const names for
// TIRE_WIDGETS / COMMAND_WIDGETS / ALERT_WIDGETS / AUTOMATION_WIDGETS /
// MAP_WIDGETS vs their plural source files).

const VEHICLE_WIDGETS: WidgetDef[] = [];
const BATTERY_WIDGETS: WidgetDef[] = [];
const ENERGY_WIDGETS: WidgetDef[] = [];
const DRIVING_WIDGETS: WidgetDef[] = [];
const CHARGING_WIDGETS: WidgetDef[] = [];
const CLIMATE_WIDGETS: WidgetDef[] = [];
const TIRE_WIDGETS: WidgetDef[] = [];
const SECURITY_WIDGETS: WidgetDef[] = [];
const COMMAND_WIDGETS: WidgetDef[] = [];
const MEDIA_WIDGETS: WidgetDef[] = [];
const TELEMETRY_WIDGETS: WidgetDef[] = [];
const ALERT_WIDGETS: WidgetDef[] = [];
const AUTOMATION_WIDGETS: WidgetDef[] = [];
const SYSTEM_WIDGETS: WidgetDef[] = [];
const MAP_WIDGETS: WidgetDef[] = [];

export const WIDGET_REGISTRY: WidgetDef[] = [
  ...VEHICLE_WIDGETS,
  ...BATTERY_WIDGETS,
  ...ENERGY_WIDGETS,
  ...DRIVING_WIDGETS,
  ...CHARGING_WIDGETS,
  ...CLIMATE_WIDGETS,
  ...TIRE_WIDGETS,
  ...SECURITY_WIDGETS,
  ...COMMAND_WIDGETS,
  ...MEDIA_WIDGETS,
  ...TELEMETRY_WIDGETS,
  ...ANALYTICS_WIDGETS,
  ...ALERT_WIDGETS,
  ...AUTOMATION_WIDGETS,
  ...SYSTEM_WIDGETS,
  ...MAP_WIDGETS,
];

export function getWidgetDef(widgetId: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((w) => w.id === widgetId);
}

export {
  VEHICLE_WIDGETS,
  BATTERY_WIDGETS,
  ENERGY_WIDGETS,
  DRIVING_WIDGETS,
  CHARGING_WIDGETS,
  CLIMATE_WIDGETS,
  TIRE_WIDGETS,
  SECURITY_WIDGETS,
  COMMAND_WIDGETS,
  MEDIA_WIDGETS,
  TELEMETRY_WIDGETS,
  ANALYTICS_WIDGETS,
  ALERT_WIDGETS,
  AUTOMATION_WIDGETS,
  SYSTEM_WIDGETS,
  MAP_WIDGETS,
};
