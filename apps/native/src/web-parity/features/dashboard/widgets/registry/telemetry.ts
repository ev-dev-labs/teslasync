// Native parity port of web/src/features/dashboard/widgets/registry/telemetry.ts.
//
// Registry data module: exports TELEMETRY_WIDGETS, the ordered list of
// "telemetry"-category dashboard widget definitions (Live Signals, Live Signal
// Sparklines, Signal Health, Signal Catalog, Signal Log). It is pure metadata —
// id / name / description / category, the default/min/max grid-size constraints,
// a per-widget icon, and a lazily-loaded widget component. The web file imports
// three things that are unavailable in the React Native parity manifest
// (contract rules 4, 5 & 7); each is replaced with a native-safe equivalent and
// documented here + in the sidecar:
//
//   - react `lazy` (web L1) is kept verbatim — React.lazy + Suspense work in
//     React Native, so the registry keeps lazily-resolved widget components.
//   - lucide-react `Wifi`, `Activity`, `BookOpen`, `ScrollText` (web L2, L10,
//     L21, L32, L43, L54) have no native SVG renderer, so the icon field is
//     typed as the shared native SemanticIcon name union and each definition
//     keeps an equivalent semantic glyph: `Wifi` -> 'wifi' (direct match; live
//     signal connectivity), `Activity` -> 'activity' (direct match; used for
//     both Live Signal Sparklines and Signal Health), `BookOpen` -> 'fileText'
//     (no native book glyph; the Signal Catalog is a browsable reference of all
//     signals — the closest "readable reference document"; 'database'/'archive'
//     are alternatives), `ScrollText` -> 'terminal' (no native scroll glyph; the
//     Signal Log is a live feed of raw signal updates that reads like a console
//     log stream — 'history'/'fileText' are alternatives).
//   - `../types` `WidgetDef` (web L3) is inlined below together with the
//     supporting WidgetSize / WidgetConfig / WidgetProps / WidgetCategory /
//     WidgetHelp types it depends on (the established widget-registry-port
//     pattern of inlining the consumed type surface; identical to the sibling
//     commands.ts port). Only `icon` diverges from the web type (LucideIcon ->
//     SemanticIconName); `component` stays
//     LazyExoticComponent<ComponentType<WidgetProps>>.
//   - the lazily-imported sibling widgets (web L15, L26, L37, L48, L59).
//     `../LiveSignalSparklinesWidget` IS already converted in the native parity
//     tree, so its lazy() is repointed at the real native widget (faithful
//     parity). The other four (`../LiveSignalsWidget`, `../SignalHealthWidget`,
//     `../SignalCatalogWidget`, `../SignalLogWidget`) are not yet present, so
//     importing them would fail the typecheck gate; each lazy() instead resolves
//     to a native-safe UnavailableNotice placeholder that renders an explicit
//     "unavailable in the native build" state until those widget files are
//     converted, at which point the lazy() factories should be repointed at
//     them. Widget ids, ordering, sizes and all other metadata are preserved
//     verbatim.
//
// No DOM-only modules, HTML elements, lucide-react, Recharts, Leaflet, or web
// @/ UI components are imported -- only react + react-native primitives and the
// shared native SemanticIcon / AppText / theme tokens.

import React, {
  lazy,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import {StyleSheet, View} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

// ── Inlined native port of the `../types` WidgetDef surface this registry uses ──
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

interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: {url: string; label?: string};
}

interface WidgetDef {
  id: string;
  name: string;
  description: string;
  // Web uses lucide-react's LucideIcon; native uses the SemanticIcon name union.
  icon: SemanticIconName;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
  help?: WidgetHelp;
}

// ── Native-safe placeholder for the not-yet-converted telemetry widgets ──
function UnavailableNotice({label}: {label: string}) {
  return React.createElement(
    View,
    {style: styles.unavailable},
    React.createElement(SemanticIcon, {
      name: 'helpCircle',
      size: 'md',
      decorative: true,
    }),
    React.createElement(
      AppText,
      {variant: 'caption', tone: 'muted', style: styles.unavailableLabel},
      `${label} is unavailable in the native build`,
    ),
  );
}

const LiveSignalsWidgetUnavailable: ComponentType<WidgetProps> = () =>
  React.createElement(UnavailableNotice, {label: 'Live Signals'});

const SignalHealthWidgetUnavailable: ComponentType<WidgetProps> = () =>
  React.createElement(UnavailableNotice, {label: 'Signal Health'});

const SignalCatalogWidgetUnavailable: ComponentType<WidgetProps> = () =>
  React.createElement(UnavailableNotice, {label: 'Signal Catalog'});

const SignalLogWidgetUnavailable: ComponentType<WidgetProps> = () =>
  React.createElement(UnavailableNotice, {label: 'Signal Log'});

export const TELEMETRY_WIDGETS: WidgetDef[] = [
  {
    id: 'live-signals',
    name: 'Live Signals',
    description: 'Real-time signal values with sparklines',
    icon: 'wifi',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 2, rows: 2},
    maxSize: {cols: 4, rows: 40},
    component: lazy(() =>
      Promise.resolve({default: LiveSignalsWidgetUnavailable}),
    ),
  },
  {
    id: 'live-signal-sparklines',
    name: 'Live Signal Sparklines',
    description:
      'Configurable list of 4-6 signals with mini sparkline charts (last 5 min)',
    icon: 'activity',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 2, rows: 4},
    maxSize: {cols: 4, rows: 40},
    component: lazy(() => import('../LiveSignalSparklinesWidget')),
  },
  {
    id: 'signal-health',
    name: 'Signal Health',
    description:
      'Telemetry signal coverage: active signals, data gaps, freshness',
    icon: 'activity',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    component: lazy(() =>
      Promise.resolve({default: SignalHealthWidgetUnavailable}),
    ),
  },
  {
    id: 'signal-catalog',
    name: 'Signal Catalog',
    description:
      'Browse all available telemetry signals with categories and observation counts',
    icon: 'fileText',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 2, rows: 4},
    maxSize: {cols: 4, rows: 40},
    component: lazy(() =>
      Promise.resolve({default: SignalCatalogWidgetUnavailable}),
    ),
  },
  {
    id: 'signal-log',
    name: 'Signal Log',
    description:
      'Live feed of raw signal updates: timestamp, signal, old→new value, source',
    icon: 'terminal',
    category: 'telemetry',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 2, rows: 4},
    maxSize: {cols: 4, rows: 40},
    component: lazy(() =>
      Promise.resolve({default: SignalLogWidgetUnavailable}),
    ),
  },
];

const styles = StyleSheet.create({
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
  },
  unavailableLabel: {
    textAlign: 'center',
  },
});
