// Native parity port of
// web/src/features/dashboard/widgets/registry/climate.ts.
//
// The web module is the "climate" slice of the dashboard widget registry: a
// typed `WidgetDef[]` (CLIMATE_WIDGETS) describing four climate tiles
// (climate-status, climate-control-panel, weather-at-car, climate-history).
// Each entry pairs static metadata (id / name / description / category / grid
// sizes) with a lucide-react `icon` component and a `React.lazy` loader for the
// tile's web widget component.
//
// This native port preserves the registry data 1:1 — the same four ids, names,
// descriptions, `climate` category, and defaultSize/minSize/maxSize grid units
// (in the same order) — using React Native-safe substitutions for the two
// browser/bundle-only fields, documented in the .parity.json sidecar:
//   - lucide-react Thermometer / CloudSun / ThermometerSun (web L2): DOM SVG
//     icon components are unavailable in React Native, so `icon` becomes a
//     glyph stand-in string that preserves each tile's icon intent (and the
//     web source's shared Thermometer between climate-status and
//     climate-control-panel).
//   - `lazy(() => import('../ClimateStatusWidget'))` & peers (web L15/26/37/48):
//     the Climate* web widget components are not yet ported into web-parity, so
//     the lazy DOM-component loaders are replaced by a native-safe lazy loader
//     (`createUnavailableWidget`) that renders an explicit "unavailable" state
//     (contract rule 7). The web `LazyExoticComponent<ComponentType<WidgetProps>>`
//     component shape is kept so the registry stays renderable and faithful.
//   - `import type { WidgetDef } from '../types'` (web L3): the web widget
//     registry types (`WidgetDef`, `WidgetSize`, `WidgetCategory`, `WidgetProps`,
//     `WidgetConfig`) are inlined here as native-safe projections because the
//     `../types` module is not yet ported into web-parity. `WidgetDef.icon` is
//     narrowed from `LucideIcon` to the glyph `string` described above.

import { createElement, lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';
import { spacing } from '../../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  Inlined native-safe widget registry types (web ../types.ts)        */
/* ------------------------------------------------------------------ */

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

/**
 * Native-safe projection of the web `WidgetDef`. `icon` is narrowed from the
 * DOM-only lucide `LucideIcon` component to a glyph stand-in string; every
 * other field mirrors the web type so the registry data round-trips faithfully.
 */
export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
}

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L2)                              */
/* ------------------------------------------------------------------ */

const ICON_THERMOMETER = '\u{1F321}\uFE0F'; // Thermometer
const ICON_CLOUD_SUN = '\u{1F324}\uFE0F'; // CloudSun
const ICON_THERMOMETER_SUN = '\u{1F321}\uFE0F\u2600\uFE0F'; // ThermometerSun

/* ------------------------------------------------------------------ */
/*  Native-safe unavailable placeholder (web lazy() loaders, rule 7)   */
/* ------------------------------------------------------------------ */

/**
 * Builds the `component` for a registry entry whose web widget component is not
 * yet ported into web-parity. The result keeps the web
 * `LazyExoticComponent<ComponentType<WidgetProps>>` shape but renders an
 * explicit, native-safe "unavailable" surface instead of a DOM widget.
 */
function createUnavailableWidget(
  widgetName: string,
): LazyExoticComponent<ComponentType<WidgetProps>> {
  const UnavailableWidget: ComponentType<WidgetProps> = () =>
    createElement(
      View,
      {
        accessibilityLabel: `${widgetName} is not yet available in the native app`,
        accessibilityRole: 'text',
        accessible: true,
        style: styles.unavailable,
      },
      createElement(
        AppText,
        { style: styles.unavailableText, tone: 'muted', variant: 'caption' },
        `${widgetName} unavailable`,
      ),
    );
  UnavailableWidget.displayName = `UnavailableWidget(${widgetName})`;
  return lazy(() => Promise.resolve({ default: UnavailableWidget }));
}

/* ------------------------------------------------------------------ */
/*  CLIMATE_WIDGETS (web L5-50)                                         */
/* ------------------------------------------------------------------ */

export const CLIMATE_WIDGETS: WidgetDef[] = [
  {
    id: 'climate-status',
    name: 'Climate',
    description: 'Inside/outside temp, HVAC state',
    icon: ICON_THERMOMETER,
    category: 'climate',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 2, rows: 40 },
    component: createUnavailableWidget('Climate'),
  },
  {
    id: 'climate-control-panel',
    name: 'Climate Control Panel',
    description:
      'Inside/outside temp, HVAC on/off, fan speed, seat heaters, steering heat',
    icon: ICON_THERMOMETER,
    category: 'climate',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Climate Control Panel'),
  },
  {
    id: 'weather-at-car',
    name: 'Weather at Car',
    description: 'Current weather at vehicle location: temp, conditions icon',
    icon: ICON_CLOUD_SUN,
    category: 'climate',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 3, rows: 40 },
    component: createUnavailableWidget('Weather at Car'),
  },
  {
    id: 'climate-history',
    name: 'Climate History',
    description: 'Inside vs outside temperature chart over time',
    icon: ICON_THERMOMETER_SUN,
    category: 'climate',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Climate History'),
  },
];

const styles = StyleSheet.create({
  unavailable: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  unavailableText: {
    textAlign: 'center',
  },
});
