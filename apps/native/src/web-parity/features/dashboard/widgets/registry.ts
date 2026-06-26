// Native parity port of web/src/features/dashboard/widgets/registry.ts.
//
// Web source (2 lines) is a pure re-export barrel that forwards two symbols
// from the split registry so older and newer import paths keep working:
//   L1  // Re-export from split registry — preserves all existing import paths
//   L2  export { WIDGET_REGISTRY, getWidgetDef } from './registry/index';
//
// ./registry/index builds:
//   • WIDGET_REGISTRY — a WidgetDef[] concatenated from 16 category
//     sub-registries (vehicle, battery, energy, driving, charging, climate,
//     tires, security, commands, media, telemetry, analytics, alerts,
//     automations, system, maps).
//   • getWidgetDef(widgetId) — WIDGET_REGISTRY.find(w => w.id === widgetId).
//
// In the file-by-file web-to-native loop the entire ./registry/index subtree is
// NOT yet ported into this parity tree: the 16 category modules each import
// lucide-react icons (browser-only) and wrap ~60 widget components through
// React.lazy(() => import('../XxxWidget')) — components that mostly do not yet
// exist in native — and the WidgetDef type itself lives in the not-yet-ported
// ../types module. Re-exporting from ./registry/index would point at missing
// files and break the native typecheck.
//
// Following the capability-record convention already used by the native charts,
// feedback, and charging-list barrels, this port keeps the web public surface
// (WIDGET_REGISTRY + getWidgetDef) with faithful types and the exact lookup
// logic preserved, backs it with a native-safe empty registry until the split
// registry subtree is converted, and documents every deferred category in
// nativeWidgetRegistryCapabilities so nothing is silently dropped.
//
// No DOM modules, browser HTML elements, lucide-react, React.lazy DOM loaders,
// Recharts, Leaflet, or old web UI components are imported here.

/**
 * Grid footprint of a widget. Mirrors web ../types `WidgetSize`
 * (cols 1-4, rows 1-8).
 */
export interface WidgetSize {
  cols: number;
  rows: number;
}

/** Widget category union. Mirrors web ../types `WidgetCategory` verbatim. */
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
 * Optional contextual-help metadata for a widget. Mirrors web ../types
 * `WidgetHelp` so the registry's public shape stays documented.
 */
export interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: { url: string; label?: string };
}

/**
 * Native-safe widget definition. Mirrors the metadata fields of web ../types
 * `WidgetDef`.
 *
 * The web type also carries `icon: LucideIcon` (a lucide-react component) and
 * `component: LazyExoticComponent<ComponentType<WidgetProps>>` (a React.lazy
 * DOM loader). Both are browser/React-DOM oriented and must not be imported
 * into native; each widget's real icon and component arrive with that widget's
 * own native port, so they are modelled here as deferred native-safe fields
 * (`icon` as an optional token string, `component` as an optional opaque value)
 * and left unset by the native-safe empty registry below.
 */
export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  icon?: string;
  component?: unknown;
  help?: WidgetHelp;
}

/**
 * The concatenated widget registry.
 *
 * Web builds this from the 16 category sub-registries listed in
 * nativeWidgetRegistryCapabilities.pending.categories. Until those modules are
 * ported into this parity tree it is intentionally empty — consumers already
 * treat lookups as possibly-missing because getWidgetDef returns
 * `WidgetDef | undefined`.
 */
export const WIDGET_REGISTRY: WidgetDef[] = [];

/**
 * Look up a widget definition by id.
 *
 * Logic preserved verbatim from the web split registry
 * (web/src/features/dashboard/widgets/registry/index.ts):
 *   return WIDGET_REGISTRY.find((w) => w.id === widgetId);
 */
export function getWidgetDef(widgetId: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((w) => w.id === widgetId);
}

/**
 * Shared explanation for why the native widget registry is currently empty.
 */
export const NATIVE_WIDGET_REGISTRY_PENDING_REASON =
  'The split widget registry subtree (./registry/index, its 16 category ' +
  'sub-registries, the ../types WidgetDef definitions, and the ~60 widget ' +
  'components wrapped with React.lazy) has not yet been ported into the React ' +
  'Native parity tree, and the category modules import lucide-react icons that ' +
  'are browser-only. WIDGET_REGISTRY is therefore intentionally empty until ' +
  'those source modules are converted by the file-by-file web-to-native loop; ' +
  'getWidgetDef keeps the exact find-by-id lookup logic and returns undefined ' +
  'for every id until then.';

/**
 * Explicit availability record for the native widget registry barrel.
 *
 * `available` lists the web `registry.ts` exports already reproduced above.
 * `pending` documents the not-yet-ported `./registry/index` subtree — every
 * category whose WidgetDef entries feed WIDGET_REGISTRY in web — so the source
 * public surface stays discoverable instead of being silently dropped. This
 * matches the capability-record convention used by the native charts, feedback,
 * and charging-list barrels.
 */
export const nativeWidgetRegistryCapabilities = {
  available: ['WIDGET_REGISTRY', 'getWidgetDef'],
  pending: {
    reason: NATIVE_WIDGET_REGISTRY_PENDING_REASON,
    source: './registry/index',
    categories: [
      'vehicle',
      'battery',
      'energy',
      'driving',
      'charging',
      'climate',
      'tires',
      'security',
      'commands',
      'media',
      'telemetry',
      'analytics',
      'alerts',
      'automations',
      'system',
      'maps',
    ],
  },
} as const;
