// Native parity port of web/src/features/dashboard/widgets/registry/vehicle.ts.
//
// The web file is a pure widget-registry data module: it exports
// `VEHICLE_WIDGETS: WidgetDef[]`, the sixteen "vehicle" category dashboard
// widgets (vehicle-hero, vehicle-hero-card, vehicle-twin, digital-twin-mini,
// software-update-status, software-update-history, odometer-counter,
// drivetrain-health, motor-performance, motor-history, vehicle-specs,
// watch-summary, maintenance-tracker, warranty-status, subscriptions,
// vehicle-upgrades). It carries no UI of its own — every entry is metadata
// (id / name / description / icon / category / size bounds) plus a
// `React.lazy(() => import('../<Widget>'))` reference used for code-splitting.
// Behaviour/metadata is preserved 1:1 (conversion rule 3): every entry keeps
// its verbatim id, name, description, category 'vehicle', and
// defaultSize / minSize / maxSize.
//
// Web/DOM-only deps mapped native-safe + documented (rules 4/5/7):
//   - `lucide-react` icons (source L2-L5: Car, CreditCard, Monitor,
//     MonitorSmartphone, Download, Hash, Cog, Zap, FileText, Watch, Wrench,
//     ShieldCheck, ArrowUpCircle) -> the native app has no `react-native-svg`
//     dependency, so a lucide icon cannot render as an SVG component (forbidden
//     by rule 4). The source field name `icon` is kept but now holds a
//     decorative glyph string. Car / CreditCard / Monitor / Zap reuse the exact
//     glyphs the sibling `dashboard/components/TemplateGallery` ICON_GLYPHS
//     table already defines ('🚗' / '💳' / '🖥' / '⚡'); ShieldCheck reuses that
//     table's `Shield: '🛡'` (warranty = protection, the same closest-variant
//     reuse `BatteryFull -> '🔋'` uses in the sibling energy.ts port). The
//     remaining identifiers are not in that table, so each is mapped here to its
//     closest-intent glyph and documented (Hash -> '＃' mirrors the table's
//     fullwidth `DollarSign: '＄'` convention), keeping icon intent consistent +
//     auditable across the parity layer.
//   - `../types` `WidgetDef` (source L6) is NOT yet ported to the native parity
//     layer, so the `WidgetDef` contract (+ its `WidgetSize` / `WidgetConfig` /
//     `WidgetProps` / `WidgetCategory` / `WidgetHelp` deps) is reproduced and
//     exported locally — the same self-contained approach the sibling
//     `registry/energy.ts` + `registry/alerts.ts` ports use. The only field that
//     changes shape is `icon` (LucideIcon -> glyph string); every other field
//     matches the web `../types` `WidgetDef` verbatim.
//   - `React.lazy(() => import('../<Widget>'))` (source L18/29/40/51/62/73/84/95/
//     106/117/128/139/150/161/172/183): two of the sixteen native widgets are
//     already ported — `digital-twin-mini` (L51) and `motor-performance` (L106).
//     For those, the real `lazy(() => import('../<Widget>'))` is kept verbatim
//     (identical relative path to the web source — maximum fidelity, real
//     code-split). The other fourteen native widgets are NOT yet ported (they
//     are converted in their own file-by-file passes); a `lazy()` import of a
//     not-yet-existent native module would not type-check, so each instead
//     resolves — via the same `React.lazy` code-split shape and the same
//     `LazyExoticComponent<ComponentType<WidgetProps>>` type — to an explicit
//     native-safe "unavailable" placeholder that names the intended widget
//     (rule 7). When those widgets are ported, a future pass swaps each
//     placeholder factory for the real native `import()`.
//
// No DOM elements, Recharts, Leaflet, framer-motion, lucide-react, or old web
// UI components are imported — only `react` (lazy/createElement), the RN
// primitives (View/StyleSheet), the native app `AppText`, and the two
// already-ported native widget modules.

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
// Car / CreditCard / Monitor / Zap match the TemplateGallery ICON_GLYPHS
// mapping ('🚗' / '💳' / '🖥' / '⚡'); ShieldCheck reuses that table's
// `Shield: '🛡'`. The remaining lucide identifiers are not in that table, so
// each is mapped here to its closest-intent glyph:
//   MonitorSmartphone -> '📲' (device receiving a software update)
//   Download          -> '📥' (download / inbox tray — update history)
//   Hash              -> '＃' (fullwidth number sign — mirrors `DollarSign: '＄'`)
//   Cog               -> '⚙'  (gear — drivetrain / motor)
//   FileText          -> '📄' (document — vehicle specs / config reference)
//   Watch             -> '⌚' (wristwatch — Apple Watch-style summary)
//   Wrench            -> '🔧' (wrench — maintenance)
//   ArrowUpCircle     -> '🔼' (upward button — OTA upgrades)
const CAR_GLYPH = '🚗';
const CREDIT_CARD_GLYPH = '💳';
const MONITOR_GLYPH = '🖥';
const MONITOR_SMARTPHONE_GLYPH = '📲';
const DOWNLOAD_GLYPH = '📥';
const HASH_GLYPH = '＃';
const COG_GLYPH = '⚙';
const ZAP_GLYPH = '⚡';
const FILE_TEXT_GLYPH = '📄';
const WATCH_GLYPH = '⌚';
const WRENCH_GLYPH = '🔧';
const SHIELD_CHECK_GLYPH = '🛡';
const ARROW_UP_CIRCLE_GLYPH = '🔼';

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

// Not-yet-ported native widgets -> native-safe "unavailable" placeholders.
const VehicleHeroWidget = lazy(async () => ({
  default: makeUnavailableWidget('VehicleHeroWidget'),
}));

const VehicleHeroCardWidget = lazy(async () => ({
  default: makeUnavailableWidget('VehicleHeroCardWidget'),
}));

const DigitalTwinWidget = lazy(async () => ({
  default: makeUnavailableWidget('DigitalTwinWidget'),
}));

const SoftwareUpdateStatusWidget = lazy(async () => ({
  default: makeUnavailableWidget('SoftwareUpdateStatusWidget'),
}));

const SoftwareUpdateHistoryWidget = lazy(async () => ({
  default: makeUnavailableWidget('SoftwareUpdateHistoryWidget'),
}));

const OdometerCounterWidget = lazy(async () => ({
  default: makeUnavailableWidget('OdometerCounterWidget'),
}));

const DrivetrainHealthWidget = lazy(async () => ({
  default: makeUnavailableWidget('DrivetrainHealthWidget'),
}));

const MotorHistoryWidget = lazy(async () => ({
  default: makeUnavailableWidget('MotorHistoryWidget'),
}));

const VehicleSpecsWidget = lazy(async () => ({
  default: makeUnavailableWidget('VehicleSpecsWidget'),
}));

const WatchSummaryWidget = lazy(async () => ({
  default: makeUnavailableWidget('WatchSummaryWidget'),
}));

const MaintenanceTrackerWidget = lazy(async () => ({
  default: makeUnavailableWidget('MaintenanceTrackerWidget'),
}));

const WarrantyStatusWidget = lazy(async () => ({
  default: makeUnavailableWidget('WarrantyStatusWidget'),
}));

const SubscriptionsWidget = lazy(async () => ({
  default: makeUnavailableWidget('SubscriptionsWidget'),
}));

const VehicleUpgradesWidget = lazy(async () => ({
  default: makeUnavailableWidget('VehicleUpgradesWidget'),
}));

// Already-ported native widgets -> real code-split import (verbatim path).
const DigitalTwinMiniWidget = lazy(() => import('../DigitalTwinMiniWidget'));
const MotorPerformanceWidget = lazy(() => import('../MotorPerformanceWidget'));

export const VEHICLE_WIDGETS: WidgetDef[] = [
  {
    id: 'vehicle-hero',
    name: 'Vehicle Card',
    description: 'Vehicle name, model, state, battery at a glance',
    icon: CAR_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 9 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: VehicleHeroWidget,
  },
  {
    id: 'vehicle-hero-card',
    name: 'Vehicle Hero Card',
    description:
      'Vehicle name, model, state badge (online/asleep/driving/charging), battery, range, temp',
    icon: CREDIT_CARD_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: VehicleHeroCardWidget,
  },
  {
    id: 'vehicle-twin',
    name: 'Digital Twin',
    description: 'Visual car state: doors, windows, lights',
    icon: MONITOR_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 3, rows: 40 },
    component: DigitalTwinWidget,
  },
  {
    id: 'digital-twin-mini',
    name: 'Digital Twin Mini',
    description:
      'Small version of vehicle digital twin SVG: doors, windows, lock, charge port',
    icon: MONITOR_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: DigitalTwinMiniWidget,
  },
  {
    id: 'software-update-status',
    name: 'Software Update',
    description:
      'Current firmware version, update availability, download/install progress bar',
    icon: MONITOR_SMARTPHONE_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: SoftwareUpdateStatusWidget,
  },
  {
    id: 'software-update-history',
    name: 'Update History',
    description: 'Firmware update timeline: versions installed, dates, changelogs',
    icon: DOWNLOAD_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: SoftwareUpdateHistoryWidget,
  },
  {
    id: 'odometer-counter',
    name: 'Odometer Counter',
    description:
      'Animated odometer with rolling digit animation and distance breakdown',
    icon: HASH_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 2, rows: 40 },
    component: OdometerCounterWidget,
  },
  {
    id: 'drivetrain-health',
    name: 'Drivetrain Health',
    description: 'Motor temp, stator temp, inverter health, overall powertrain score',
    icon: COG_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: DrivetrainHealthWidget,
  },
  {
    id: 'motor-performance',
    name: 'Motor Performance',
    description: 'Live motor data: torque, stator temp, gear state, g-forces',
    icon: ZAP_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: MotorPerformanceWidget,
  },
  {
    id: 'motor-history',
    name: 'Motor History',
    description: 'Motor torque and stator temp over time with danger zone highlighting',
    icon: COG_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: MotorHistoryWidget,
  },
  {
    id: 'vehicle-specs',
    name: 'Vehicle Specs',
    description: 'Configuration reference: model, trim, paint, wheels, options',
    icon: FILE_TEXT_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: VehicleSpecsWidget,
  },
  {
    id: 'watch-summary',
    name: 'Watch Summary',
    description: 'Apple Watch-style compact view: battery, range, state, lock status',
    icon: WATCH_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 2, rows: 40 },
    component: WatchSummaryWidget,
  },
  {
    id: 'maintenance-tracker',
    name: 'Maintenance',
    description: 'Upcoming maintenance reminders + recent service history',
    icon: WRENCH_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: MaintenanceTrackerWidget,
  },
  {
    id: 'warranty-status',
    name: 'Warranty Status',
    description: 'Warranty countdown: time remaining, mileage remaining, coverage types',
    icon: SHIELD_CHECK_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 3, rows: 40 },
    component: WarrantyStatusWidget,
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    description: 'Tesla subscriptions: Premium Connectivity, FSD, expiry dates, renewal',
    icon: CREDIT_CARD_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: SubscriptionsWidget,
  },
  {
    id: 'vehicle-upgrades',
    name: 'Upgrades & Sharing',
    description: 'Available OTA upgrades with pricing + active drive share links',
    icon: ARROW_UP_CIRCLE_GLYPH,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: VehicleUpgradesWidget,
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
