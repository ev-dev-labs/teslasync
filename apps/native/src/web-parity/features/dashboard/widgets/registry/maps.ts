// Native parity port of
// web/src/features/dashboard/widgets/registry/maps.ts.
//
// The web module is the "maps & location" slice of the dashboard widget
// catalogue: a static array of widget definitions (id, name, description,
// icon, category, sizing, lazy component) consumed by the widget picker and
// the dashboard grid. It is pure metadata — there is no JSX, state, API path,
// unit handling, or i18n in the source — so the port preserves every field of
// every entry verbatim and only the two browser-only fields are made
// native-safe, following the established dashboard idiom (battery.ts / media.ts
// registry siblings / WidgetPicker / DashboardSettingsModal inline native-safe
// mirrors of these same types):
//
//   - `icon: LucideIcon` (lucide-react, web L2) has no native icon font, and
//     lucide-react is browser-only and must never enter native output. The
//     icon is therefore kept as its lucide identity string `iconName`
//     (e.g. 'MapPin'). The web `Map as MapIcon` alias resolves to the lucide
//     identity 'Map'. This drops the rendered glyph but preserves exactly
//     which icon each widget uses; a native consumer can map the name to a
//     glyph, matching the dashboard WidgetPicker idiom.
//   - `component: lazy(() => import('../X'))` (web L1 + per-entry) lazily loads
//     each widget's React component. None of these five map widgets are ported
//     to native yet, and on web they are Leaflet-based (browser-only); a live
//     `import()` of a missing or browser-only module would break the native
//     build, so the component is kept as its module-path string
//     `componentModule` (e.g. '../LocationMapWidget') — the same relative path
//     resolves under the native widgets directory once each widget is ported.
//     The mapping is preserved as data; wiring it back to a real lazy component
//     is deferred to when those widgets land natively.
//
// Because the web `../types` module itself imports lucide-react (LucideIcon)
// and React.lazy, the slice of its types that `WidgetDef` needs is mirrored
// inline here native-safe rather than imported — matching the established
// dashboard idiom. The exported surface mirrors the web file: only
// `MAP_WIDGETS`.
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

/* ─── MAP_WIDGETS (web .../registry/maps.ts) ──────────────────────────────── */

export const MAP_WIDGETS: WidgetDef[] = [
  {
    id: 'location-map',
    name: 'Vehicle Location Map',
    description: 'Live map of vehicle position with heading arrow',
    iconName: 'MapPin',
    category: 'maps',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 4},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../LocationMapWidget',
  },
  {
    id: 'location-favorites',
    name: 'Favorite Locations',
    description: 'Frequently visited places, current location status (home/work/other)',
    iconName: 'MapPin',
    category: 'maps',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../LocationFavoritesWidget',
  },
  {
    id: 'geofence-status',
    name: 'Geofence Status',
    description: 'Configured geofences with inside/outside status for current vehicle',
    iconName: 'Crosshair',
    category: 'maps',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../GeofenceWidget',
  },
  {
    id: 'destination-eta',
    name: 'Destination ETA',
    description: 'Active navigation: destination, distance remaining, arrival countdown',
    iconName: 'Navigation2',
    category: 'maps',
    defaultSize: {cols: 2, rows: 2},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 3, rows: 40},
    componentModule: '../DestinationETAWidget',
  },
  {
    id: 'position-heatmap',
    name: 'Position Heatmap',
    description: 'GPS position density heatmap: frequently visited locations glow brighter',
    iconName: 'Map',
    category: 'maps',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 2, rows: 4},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../PositionHeatmapWidget',
  },
];
