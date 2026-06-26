// Native parity port of web/src/features/dashboard/widgets/registry/driving.ts.
//
// Web source (157 lines) is a pure metadata module: it exports
// `DRIVING_WIDGETS: WidgetDef[]`, the 13-entry "driving" slice of the split
// dashboard widget registry. Each entry is plain configuration data (id, name,
// description, category, defaultSize/minSize/maxSize, optional help) plus two
// browser/React-DOM-coupled fields that cannot cross into native unchanged:
//
//   L1     import { lazy } from 'react';
//   L2-L5  import { Car, TrendingUp, List, Gauge, Grid3X3, Activity,
//          RotateCcw, Route, Lightbulb, Navigation } from 'lucide-react';
//   L6     import type { WidgetDef } from '../types';
//
// • lucide-react (L2-L5) is a browser SVG icon library and is forbidden in
//   native output, so each `icon: <LucideIcon>` is preserved as its lucide
//   token string (e.g. `icon: 'Car'`) on the native-safe `WidgetDef.icon?:
//   string` field — the visual/icon intent is kept and re-wired to a native
//   icon when each widget is ported.
// • `component: lazy(() => import('../XxxWidget'))` (L1 + each entry) is a
//   React.lazy DOM loader pointing at web widget components that are not yet
//   ported into this parity tree, so `component` is left unset (the native-safe
//   `WidgetDef.component?: unknown` field) and every deferred component module
//   is recorded in nativeDrivingWidgetsCapabilities.pending.components so the
//   mapping is documented, not silently dropped.
// • `WidgetDef` (L6) is imported from the already-ported native registry barrel
//   (../registry) — the canonical native home of the native-safe WidgetDef /
//   WidgetSize / WidgetCategory / WidgetHelp types — instead of from the
//   not-yet-ported ../types module, keeping a single source of truth.
//
// All other source data (every id, name, description, size triple, the
// `category: 'driving'` tag, and the regen-efficiency help block with its
// i18nKey + defaultValue) is reproduced verbatim. No DOM modules, browser HTML
// elements, lucide-react, React.lazy DOM loaders, Recharts, Leaflet, or old web
// UI components are imported here.

import type { WidgetDef } from '../registry';

/**
 * The "driving" slice of the dashboard widget registry.
 *
 * Mirrors web/src/features/dashboard/widgets/registry/driving.ts
 * `DRIVING_WIDGETS` one-for-one (same 13 widgets, same order, same metadata).
 * `icon` carries the original lucide token string; `component` is intentionally
 * unset until each widget's native port lands — see
 * nativeDrivingWidgetsCapabilities.pending.components.
 */
export const DRIVING_WIDGETS: WidgetDef[] = [
  {
    id: 'recent-drives',
    name: 'Recent Drives',
    description: 'Last 5 drives with distance and efficiency',
    icon: 'Car',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'drive-score',
    name: 'Driving Score',
    description: 'Weekly efficiency and driving score',
    icon: 'TrendingUp',
    category: 'driving',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 2, rows: 40 },
  },
  {
    id: 'recent-drives-list',
    name: 'Recent Drives List',
    description: 'Last 5-10 drives: distance, duration, efficiency, start/end locations',
    icon: 'List',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'drive-score-gauge',
    name: 'Drive Score Gauge',
    description: 'Radial gauge showing weekly score (0-100) with efficiency, smoothness, and speed breakdown',
    icon: 'Gauge',
    category: 'driving',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 2, rows: 40 },
  },
  {
    id: 'drive-efficiency-chart',
    name: 'Drive Efficiency Chart',
    description: 'Area chart of Wh/mi over last 30 days with rolling average overlay',
    icon: 'TrendingUp',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'speed-heatmap',
    name: 'Speed Heatmap',
    description: 'Heatmap: time-of-day vs day-of-week speed distribution',
    icon: 'Grid3X3',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'driving-dynamics',
    name: 'Driving Dynamics',
    description: 'Acceleration, braking, lateral g-forces with driving style indicator',
    icon: 'Gauge',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'speed-profile',
    name: 'Speed Profile',
    description: 'Speed distribution histogram with efficiency overlay — find your optimal speed',
    icon: 'Activity',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'regen-efficiency',
    name: 'Regen Braking',
    description: 'Regenerative braking recovery rate, total kWh recovered, max regen power',
    icon: 'RotateCcw',
    category: 'driving',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 3, rows: 40 },
    help: {
      i18nKey: 'help.regenEfficiency.body',
      defaultValue:
        'Energy recovered through regenerative braking divided by total energy used during driving. Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving.',
    },
  },
  {
    id: 'route-efficiency',
    name: 'Route Efficiency',
    description: 'Recurring routes ranked by energy efficiency with weather/elevation impact',
    icon: 'Route',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'driving-coach',
    name: 'Driving Coach',
    description: 'Helix-powered driving tips: personalized efficiency recommendations',
    icon: 'Lightbulb',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'trip-summary',
    name: 'Trip Summary',
    description: 'Recent trips: start→end, distance, duration, drive segments, charge stops',
    icon: 'Navigation',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'drive-telemetry',
    name: 'Drive Telemetry',
    description: 'Last drive replay: speed, power, battery over time with route',
    icon: 'Activity',
    category: 'driving',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
  },
];

/**
 * Explicit availability record for the native "driving" widget sub-registry.
 *
 * `available` lists the web export reproduced above. `pending.components` maps
 * each widget id to the web widget module its `component: lazy(() =>
 * import('../XxxWidget'))` loader targets — modules not yet ported into this
 * parity tree, so each entry's `component` is left unset until its native port
 * lands. This mirrors the capability-record convention used by the native
 * registry, charts, and feedback barrels so the deferred wiring stays
 * discoverable instead of being silently dropped.
 */
export const nativeDrivingWidgetsCapabilities = {
  available: ['DRIVING_WIDGETS'],
  pending: {
    reason:
      'Each driving widget component is a React.lazy(() => ' +
      'import("../XxxWidget")) DOM loader whose target widget is not yet ' +
      'ported into the React Native parity tree, so the WidgetDef.component ' +
      'field is left unset on every entry until that widget native port lands. ' +
      'Icons keep their original lucide token strings on WidgetDef.icon rather ' +
      'than the browser-only lucide-react components.',
    components: {
      'recent-drives': '../RecentDrivesWidget',
      'drive-score': '../DriveScoreWidget',
      'recent-drives-list': '../RecentDrivesListWidget',
      'drive-score-gauge': '../DriveScoreGaugeWidget',
      'drive-efficiency-chart': '../DriveEfficiencyChartWidget',
      'speed-heatmap': '../SpeedHeatmapWidget',
      'driving-dynamics': '../DrivingDynamicsWidget',
      'speed-profile': '../SpeedProfileWidget',
      'regen-efficiency': '../RegenEfficiencyWidget',
      'route-efficiency': '../RouteEfficiencyWidget',
      'driving-coach': '../DrivingCoachWidget',
      'trip-summary': '../TripSummaryWidget',
      'drive-telemetry': '../DriveTelemetryWidget',
    },
  },
} as const;
