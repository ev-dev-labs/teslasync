// Native parity port of
// web/src/features/dashboard/widgets/registry/battery.ts.
//
// The web module is the "battery & range" slice of the dashboard widget
// catalogue: a static array of widget definitions (id, name, description,
// icon, category, sizing, lazy component) consumed by the widget picker and
// the dashboard grid. It is pure metadata — there is no JSX, state, API path,
// unit handling, or i18n in the source — so the port preserves every field of
// every entry verbatim and only the two browser-only fields are made
// native-safe:
//
//   - `icon: LucideIcon` (lucide-react, web L2-4) has no native icon font, and
//     lucide-react is browser-only and must never enter native output. The
//     icon is therefore kept as its lucide identity string `iconName`
//     (e.g. 'Battery'). This drops the rendered glyph but preserves exactly
//     which icon each widget uses; a native consumer can map the name to a
//     glyph, matching the dashboard WidgetPicker idiom.
//   - `component: lazy(() => import('../X'))` (web L1 + per-entry) lazily loads
//     each widget's React component. Most of those widget components are not
//     yet ported to native (only EnergyFlowWidget and BatteryHealthAnalytics-
//     Widget exist in this directory today), and a live `import()` of a
//     missing or browser-only module would break the native build, so the
//     component is kept as its module-path string `componentModule`
//     (e.g. '../BatteryGaugeWidget') — the same relative path resolves under
//     the native widgets directory once each widget is ported. The mapping is
//     preserved as data; wiring it back to a real lazy component is deferred
//     to when those widgets land natively.
//
// Because the web `../types` module itself imports lucide-react (LucideIcon)
// and React.lazy, the slice of its types that `WidgetDef` needs is mirrored
// inline here native-safe rather than imported — matching the established
// dashboard idiom (WidgetPicker / DashboardSettingsModal inline native-safe
// mirrors of these same types). The exported surface mirrors the web file:
// only `BATTERY_WIDGETS`.
//
// No DOM, react, react-router, framer-motion, lucide-react, Recharts, Leaflet,
// or old web UI components are imported into the native output.

/* ─── Native-safe mirror of ../types (slice needed by WidgetDef) ──────────── */

interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
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

interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: {url: string; label?: string};
}

// Web `icon: LucideIcon` -> `iconName: string`; web
// `component: lazy(() => import(...))` -> `componentModule: string` (see header).
interface WidgetDef {
  id: string;
  name: string;
  description: string;
  iconName: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  componentModule: string;
  help?: WidgetHelp;
}

/* ─── BATTERY_WIDGETS (web .../registry/battery.ts) ───────────────────────── */

export const BATTERY_WIDGETS: WidgetDef[] = [
  {
    id: 'battery-gauge',
    name: 'Battery Level',
    description: 'Battery percentage with radial gauge',
    iconName: 'Battery',
    category: 'battery',
    defaultSize: {cols: 1, rows: 2},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 2, rows: 40},
    componentModule: '../BatteryGaugeWidget',
  },
  {
    id: 'battery-radial-gauge',
    name: 'Battery Radial Gauge',
    description:
      'Large radial gauge showing battery percentage with color gradient (green>amber>red)',
    iconName: 'Battery',
    category: 'battery',
    defaultSize: {cols: 1, rows: 2},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 3, rows: 40},
    componentModule: '../BatteryRadialGaugeWidget',
  },
  {
    id: 'range-estimate',
    name: 'Range Estimate',
    description: 'Rated, ideal, and estimated range',
    iconName: 'Gauge',
    category: 'battery',
    defaultSize: {cols: 1, rows: 2},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 2, rows: 40},
    componentModule: '../RangeEstimateWidget',
  },
  {
    id: 'range-bar',
    name: 'Range Bar',
    description:
      'Horizontal bar showing rated, ideal, and estimated range with EPA comparison',
    iconName: 'Gauge',
    category: 'battery',
    defaultSize: {cols: 2, rows: 2},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../RangeBarWidget',
  },
  {
    id: 'battery-degradation-trend',
    name: 'Battery Degradation Trend',
    description: 'Line chart showing max range capacity over months',
    iconName: 'TrendingUp',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../BatteryDegradationTrendWidget',
  },
  {
    id: 'energy-flow',
    name: 'Energy Flow',
    description: 'Live power flow diagram',
    iconName: 'Activity',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 2, rows: 4},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../EnergyFlowWidget',
  },
  {
    id: 'projected-range',
    name: 'Projected Range',
    description:
      'Helix-predicted range based on driving habits, weather, elevation',
    iconName: 'Navigation',
    category: 'battery',
    defaultSize: {cols: 2, rows: 2},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 3, rows: 40},
    componentModule: '../ProjectedRangeWidget',
  },
  {
    id: 'battery-cells',
    name: 'Battery Cells',
    description:
      'Cell-level voltage heatmap, min/max/avg, temperature per module',
    iconName: 'Cpu',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 2, rows: 4},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../BatteryCellsWidget',
  },
  {
    id: 'battery-degradation-forecast',
    name: 'Battery Forecast',
    description:
      'Predictive degradation: when battery hits 80%, risk factors, recommendations',
    iconName: 'TrendingDown',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../BatteryDegradationForecastWidget',
  },
  {
    id: 'battery-health-analytics',
    name: 'Battery Analytics',
    description:
      'Deep battery health: cycles, charge depth, temp exposure, DC fast ratio',
    iconName: 'HeartPulse',
    category: 'battery',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../BatteryHealthAnalyticsWidget',
  },
];
