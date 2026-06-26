// Native parity port of
// web/src/features/dashboard/widgets/registry/media.ts.
//
// The web module is the "media" slice of the dashboard widget catalogue: a
// static array of widget definitions (id, name, description, icon, category,
// sizing, lazy component) consumed by the widget picker and the dashboard
// grid. It is pure metadata — there is no JSX, state, API path, unit handling,
// or i18n in the source — so the port preserves every field of every entry
// verbatim and only the two browser-only fields are made native-safe,
// following the established dashboard idiom (battery.ts registry sibling /
// WidgetPicker / DashboardSettingsModal inline native-safe mirrors of these
// same types):
//
//   - `icon: LucideIcon` (lucide-react, web L2) has no native icon font, and
//     lucide-react is browser-only and must never enter native output. The
//     icon is therefore kept as its lucide identity string `iconName`
//     (e.g. 'Music'). This drops the rendered glyph but preserves exactly
//     which icon each widget uses; a native consumer can map the name to a
//     glyph, matching the dashboard WidgetPicker idiom.
//   - `component: lazy(() => import('../X'))` (web L1 + per-entry) lazily loads
//     each widget's React component. `MediaHistoryWidget` is already ported
//     natively, but `MediaNowPlayingWidget` is not yet, and a live `import()`
//     of a missing or browser-only module would break the native build, so the
//     component is kept as its module-path string `componentModule`
//     (e.g. '../MediaNowPlayingWidget') — the same relative path resolves under
//     the native widgets directory once each widget is ported. The mapping is
//     preserved as data; wiring it back to a real lazy component is deferred to
//     when those widgets land natively.
//
// Because the web `../types` module itself imports lucide-react (LucideIcon)
// and React.lazy, the slice of its types that `WidgetDef` needs is mirrored
// inline here native-safe rather than imported — matching the established
// dashboard idiom. The exported surface mirrors the web file: only
// `MEDIA_WIDGETS`.
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

/* ─── MEDIA_WIDGETS (web .../registry/media.ts) ───────────────────────────── */

export const MEDIA_WIDGETS: WidgetDef[] = [
  {
    id: 'media-now-playing',
    name: 'Now Playing',
    description: 'Current media: song title, artist, source',
    iconName: 'Music',
    category: 'media',
    defaultSize: {cols: 2, rows: 2},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../MediaNowPlayingWidget',
  },
  {
    id: 'media-history',
    name: 'Media History',
    description: 'Recently played tracks: title, artist, source, playback history',
    iconName: 'ListMusic',
    category: 'media',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    componentModule: '../MediaHistoryWidget',
  },
];
