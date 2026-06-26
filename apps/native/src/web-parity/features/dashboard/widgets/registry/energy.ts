// Native parity port of web/src/features/dashboard/widgets/registry/energy.ts.
//
// The web file is a pure widget-registry data module: it exports
// `ENERGY_WIDGETS: WidgetDef[]`, the nine "energy" category dashboard widgets
// (energy-flow-animated, vampire-drain, sleep-efficiency, solar-production,
// live-power-flow, energy-site-info, backup-history, power-flow-history,
// energy-stats). It carries no UI of its own — every entry is metadata
// (id / name / description / icon / category / size bounds, plus optional
// `help`) and a `React.lazy(() => import('../<Widget>'))` reference used for
// code-splitting. Behaviour/metadata is preserved 1:1 (conversion rule 3):
// every entry keeps its verbatim id, name, description, category 'energy',
// defaultSize / minSize / maxSize, and (for vampire-drain + sleep-efficiency)
// its `help.i18nKey` + `help.defaultValue`.
//
// Web/DOM-only deps mapped native-safe + documented (rules 4/5/7):
//   - `lucide-react` icons (source L2-L4: Workflow, BatteryWarning, Moon, Sun,
//     Home, BatteryFull, TrendingUp, Zap) -> the native app has no
//     `react-native-svg` dependency, so a lucide icon cannot render as an SVG
//     component (forbidden by rule 4). The source field name `icon` is kept but
//     now holds a decorative glyph string. Workflow / TrendingUp / Zap reuse the
//     exact glyphs the sibling `dashboard/components/TemplateGallery` ICON_GLYPHS
//     table already defines ('🔀' / '📈' / '⚡'); the four not in that table
//     (BatteryWarning / Moon / Sun / Home / BatteryFull) are mapped here to the
//     closest-intent glyph and documented, keeping the icon intent consistent +
//     auditable across the parity layer.
//   - `../types` `WidgetDef` (source L5) is NOT yet ported to the native parity
//     layer, so the `WidgetDef` contract (+ its `WidgetSize` / `WidgetConfig` /
//     `WidgetProps` / `WidgetCategory` / `WidgetHelp` deps) is reproduced and
//     exported locally — the same self-contained approach the sibling
//     `registry/alerts.ts` port and the widget ports (FleetStats / QuickNav /
//     AnomalyDetector) use. The only field that changes shape is `icon`
//     (LucideIcon -> glyph string); every other field matches the web
//     `../types` `WidgetDef` verbatim.
//   - `React.lazy(() => import('../<Widget>'))` (source L17/28/44/60/71/82/93/
//     104/115): none of the nine native energy widgets are ported yet (they are
//     converted in their own file-by-file passes). A `lazy()` import of a
//     not-yet-existent native module would not type-check, so each lazy ref
//     instead resolves — via the same `React.lazy` code-split shape and the same
//     `LazyExoticComponent<ComponentType<WidgetProps>>` type — to an explicit
//     native-safe "unavailable" placeholder that names the intended widget
//     (rule 7). When those widgets are ported, a future pass swaps the
//     placeholder factory for the real native `import()`.
//
// No DOM elements, Recharts, Leaflet, framer-motion, lucide-react, or old web
// UI components are imported — only `react` (lazy/createElement), the RN
// primitives (View/StyleSheet), and the native app `AppText`.

import React, { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';

// ── Native-safe WidgetDef contract (web ../types not yet ported) ─────────────
// Reproduced from web/src/features/dashboard/widgets/types.ts. Field shapes are
// verbatim except `icon`, which becomes a decorative glyph string on native
// (the lucide SVG component has no native analog — see the header note).

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

export interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: { url: string; label?: string };
}

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  /**
   * Decorative glyph stand-in for the web lucide `icon` (no react-native-svg).
   * Web type was `LucideIcon`; native carries the mapped glyph string.
   */
  icon: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
  help?: WidgetHelp;
}

// ── lucide icon glyph stand-ins ──────────────────────────────────────────────
// Workflow / TrendingUp / Zap match the TemplateGallery ICON_GLYPHS mapping
// ('🔀' / '📈' / '⚡'). The remaining lucide identifiers are not in that table,
// so each is mapped here to its closest-intent glyph:
//   BatteryWarning -> '🪫' (low/at-risk battery — phantom/vampire drain)
//   Moon           -> '🌙' (sleep efficiency)
//   Sun            -> '☀️' (solar production)
//   Home           -> '🏠' (energy site / home)
//   BatteryFull    -> '🔋' (full battery — matches ICON_GLYPHS `Battery`)
const WORKFLOW_GLYPH = '🔀';
const BATTERY_WARNING_GLYPH = '🪫';
const MOON_GLYPH = '🌙';
const SUN_GLYPH = '☀️';
const HOME_GLYPH = '🏠';
const BATTERY_FULL_GLYPH = '🔋';
const TRENDING_UP_GLYPH = '📈';
const ZAP_GLYPH = '⚡';

// ── Native-safe lazy placeholder (rule 7) ────────────────────────────────────
// Stands in for `lazy(() => import('../<Widget>'))` until the native widget is
// ported. Renders an explicit "unavailable" state naming the intended widget,
// so the absence is surfaced (never silently blank) if the registry entry is
// ever mounted on native.
function makeUnavailableWidget(
  widgetName: string,
): ComponentType<WidgetProps> {
  function UnavailableWidget(_props: WidgetProps) {
    return React.createElement(
      View,
      { style: styles.placeholder },
      React.createElement(
        AppText,
        { tone: 'muted', variant: 'caption', style: styles.placeholderText },
        `${widgetName} unavailable on native`,
      ),
    );
  }
  UnavailableWidget.displayName = `Unavailable(${widgetName})`;
  return UnavailableWidget;
}

const EnergyFlowAnimatedWidget = lazy(async () => ({
  default: makeUnavailableWidget('EnergyFlowAnimatedWidget'),
}));

const VampireDrainWidget = lazy(async () => ({
  default: makeUnavailableWidget('VampireDrainWidget'),
}));

const SleepEfficiencyWidget = lazy(async () => ({
  default: makeUnavailableWidget('SleepEfficiencyWidget'),
}));

const SolarProductionWidget = lazy(async () => ({
  default: makeUnavailableWidget('SolarProductionWidget'),
}));

const LivePowerFlowWidget = lazy(async () => ({
  default: makeUnavailableWidget('LivePowerFlowWidget'),
}));

const EnergySiteInfoWidget = lazy(async () => ({
  default: makeUnavailableWidget('EnergySiteInfoWidget'),
}));

const BackupHistoryWidget = lazy(async () => ({
  default: makeUnavailableWidget('BackupHistoryWidget'),
}));

const PowerFlowHistoryWidget = lazy(async () => ({
  default: makeUnavailableWidget('PowerFlowHistoryWidget'),
}));

const EnergyStatsWidget = lazy(async () => ({
  default: makeUnavailableWidget('EnergyStatsWidget'),
}));

export const ENERGY_WIDGETS: WidgetDef[] = [
  {
    id: 'energy-flow-animated',
    name: 'Energy Flow Animated',
    description:
      'Animated energy flow diagram: battery→drive, regen→battery, charger→battery',
    icon: WORKFLOW_GLYPH,
    category: 'energy',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 3, rows: 40 },
    component: EnergyFlowAnimatedWidget,
  },
  {
    id: 'vampire-drain',
    name: 'Vampire Drain',
    description: 'Phantom drain rate: avg %/day, recent drain events',
    icon: BATTERY_WARNING_GLYPH,
    category: 'energy',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: VampireDrainWidget,
    help: {
      i18nKey: 'help.vampireDrain.body',
      defaultValue:
        'Idle energy lost while the car is parked and not charging. We compute it as the % of battery used per hour while the vehicle reports gear=Park and is not in motion.',
    },
  },
  {
    id: 'sleep-efficiency',
    name: 'Sleep Efficiency',
    description: 'How well the car sleeps: efficiency %, drain rate, wake events',
    icon: MOON_GLYPH,
    category: 'energy',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 3, rows: 40 },
    component: SleepEfficiencyWidget,
    help: {
      i18nKey: 'help.sleepEfficiency.body',
      defaultValue:
        'Share of parked time the car spent in true low-power sleep (vs. idle/online). Higher is better — more sleep means less vampire drain and lower battery wear.',
    },
  },
  {
    id: 'solar-production',
    name: 'Solar Production',
    description: 'Daily solar generation chart from Tesla Energy / Powerwall',
    icon: SUN_GLYPH,
    category: 'energy',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: SolarProductionWidget,
  },
  {
    id: 'live-power-flow',
    name: 'Live Power Flow',
    description: 'Real-time solar→battery→home→grid power routing diagram',
    icon: WORKFLOW_GLYPH,
    category: 'energy',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: LivePowerFlowWidget,
  },
  {
    id: 'energy-site-info',
    name: 'Energy Site',
    description:
      'Tesla Energy system: solar capacity, Powerwall count, gateway firmware',
    icon: HOME_GLYPH,
    category: 'energy',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: EnergySiteInfoWidget,
  },
  {
    id: 'backup-history',
    name: 'Backup History',
    description:
      'Power outage events: Powerwall backup triggers, duration, energy used',
    icon: BATTERY_FULL_GLYPH,
    category: 'energy',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: BackupHistoryWidget,
  },
  {
    id: 'power-flow-history',
    name: 'Power Flow History',
    description:
      'Historical solar/battery/grid/home power routing over 24 hours',
    icon: TRENDING_UP_GLYPH,
    category: 'energy',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: PowerFlowHistoryWidget,
  },
  {
    id: 'energy-stats',
    name: 'Energy Stats',
    description:
      'Energy overview: daily usage chart, total used/charged, efficiency, CO₂ saved',
    icon: ZAP_GLYPH,
    category: 'energy',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: EnergyStatsWidget,
  },
];

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  placeholderText: {
    textAlign: 'center',
  },
});
