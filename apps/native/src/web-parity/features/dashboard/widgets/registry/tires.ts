// Native parity port of web/src/features/dashboard/widgets/registry/tires.ts.
//
// Web source (28 lines) is a pure metadata module: it exports
// `TIRE_WIDGETS: WidgetDef[]`, the 2-entry "tires" slice of the split dashboard
// widget registry. Each entry is plain configuration data (id, name,
// description, category, defaultSize/minSize/maxSize) plus two
// browser/React-DOM-coupled fields that cannot cross into native unchanged:
//
//   L1   import { lazy } from 'react';
//   L2   import { CircleDot } from 'lucide-react';
//   L3   import type { WidgetDef } from '../types';
//
// • lucide-react (L2) is a browser SVG icon library and is forbidden in native
//   output, so each `icon: CircleDot` is preserved as its lucide token string
//   (`icon: 'CircleDot'`) on the native-safe `WidgetDef.icon?: string` field —
//   the visual/icon intent is kept and re-wired to a native icon when each
//   widget is ported.
// • `component: lazy(() => import('../XxxWidget'))` (L1 + each entry) is a
//   React.lazy DOM loader pointing at web widget components that are not yet
//   ported into this parity tree, so `component` is left unset (the native-safe
//   `WidgetDef.component?: unknown` field) and every deferred component module
//   is recorded in nativeTireWidgetsCapabilities.pending.components so the
//   mapping is documented, not silently dropped.
// • `WidgetDef` (L3) is imported from the already-ported native registry barrel
//   (../registry) — the canonical native home of the native-safe WidgetDef /
//   WidgetSize / WidgetCategory / WidgetHelp types — instead of from the
//   not-yet-ported ../types module, keeping a single source of truth.
//
// All other source data (both ids, names, descriptions, size triples, and the
// `category: 'tires'` tag) is reproduced verbatim. No DOM modules, browser HTML
// elements, lucide-react, React.lazy DOM loaders, Recharts, Leaflet, or old web
// UI components are imported here.

import type { WidgetDef } from '../registry';

/**
 * The "tires" slice of the dashboard widget registry.
 *
 * Mirrors web/src/features/dashboard/widgets/registry/tires.ts `TIRE_WIDGETS`
 * one-for-one (same 2 widgets, same order, same metadata). `icon` carries the
 * original lucide token string; `component` is intentionally unset until each
 * widget's native port lands — see
 * nativeTireWidgetsCapabilities.pending.components.
 */
export const TIRE_WIDGETS: WidgetDef[] = [
  {
    id: 'tire-pressure-visual',
    name: 'Tire Pressure Visual',
    description: 'Four-tire diagram with pressure per tire, color-coded (green/amber/red)',
    icon: 'CircleDot',
    category: 'tires',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
  },
  {
    id: 'tire-pressure-history',
    name: 'Tire Pressure History',
    description: 'Pressure trends for all 4 tires over time with recommended range',
    icon: 'CircleDot',
    category: 'tires',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
  },
];

/**
 * Explicit availability record for the native "tires" widget sub-registry.
 *
 * `available` lists the web export reproduced above. `pending.components` maps
 * each widget id to the web widget module its `component: lazy(() =>
 * import('../XxxWidget'))` loader targets — modules not yet ported into this
 * parity tree, so each entry's `component` is left unset until its native port
 * lands. This mirrors the capability-record convention used by the native
 * registry, charts, and feedback barrels so the deferred wiring stays
 * discoverable instead of being silently dropped.
 */
export const nativeTireWidgetsCapabilities = {
  available: ['TIRE_WIDGETS'],
  pending: {
    reason:
      'Each tire widget component is a React.lazy(() => ' +
      'import("../XxxWidget")) DOM loader whose target widget is not yet ' +
      'ported into the React Native parity tree, so the WidgetDef.component ' +
      'field is left unset on every entry until that widget native port lands. ' +
      'Icons keep their original lucide token strings on WidgetDef.icon rather ' +
      'than the browser-only lucide-react components.',
    components: {
      'tire-pressure-visual': '../TirePressureVisualWidget',
      'tire-pressure-history': '../TirePressureHistoryWidget',
    },
  },
} as const;
