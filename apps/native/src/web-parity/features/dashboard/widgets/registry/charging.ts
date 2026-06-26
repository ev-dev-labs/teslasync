// Native parity port of web/src/features/dashboard/widgets/registry/charging.ts.
//
// The web file is a pure data module: it exports CHARGING_WIDGETS, the registry
// of 13 charging dashboard tiles (id / name / description / icon / category /
// default+min+max grid size / lazy-loaded component). It is non-visual metadata,
// so the port keeps the array verbatim and only adapts the two non-native
// pieces:
//
//   * `icon` was a DOM-only lucide-react component (LucideIcon). Native renders
//     icons through the repo SemanticIcon system, so each lucide glyph is mapped
//     to its closest SemanticIconName and the field is retyped `SemanticIconName`
//     (Zap->bolt, BarChart3->analytics, DollarSign->dollarSign, Calendar->
//     calendar, TrendingUp->trendUp, Sparkles->sparkles, Plug->charger,
//     Gauge->speedCircle, Clock->clock).
//   * `component` was `lazy(() => import('../SomeWidget'))`. React.lazy + dynamic
//     import are native-safe, but only ChargingScheduleWidget has a native port
//     today; that one is wired to the real `../ChargingScheduleWidget`. The other
//     12 native widget modules do not exist yet, so they resolve to a shared
//     native-safe "unavailable" placeholder (explicit unavailable state) and keep
//     a trailing comment recording the web module each one maps to.
//
// `../types` has no native port yet, so the consumed types (WidgetSize,
// WidgetConfig, WidgetProps, WidgetCategory, WidgetHelp, WidgetDef) are mirrored
// field-for-field inline — exactly as the sibling native widget ports do — so
// this module stays self-contained. Only CHARGING_WIDGETS is exported, matching
// the source's single export.
//
// Line-by-line coverage of the source:
//   L1     `import { lazy } from 'react'` -> kept (lazy is native-safe); also
//          pull in createElement + the ComponentType/LazyExoticComponent types
//          for the inlined placeholder and the mirrored WidgetDef.component type.
//   L2-4   lucide-react icon imports (Zap/BarChart3/DollarSign/Calendar/
//          TrendingUp/Sparkles/Plug/Gauge/Clock) -> dropped; replaced by the
//          SemanticIconName string mapping above (no DOM icon component).
//   L5     `import type { WidgetDef } from '../types'` -> mirrored inline below.
//   L7     `export const CHARGING_WIDGETS: WidgetDef[] = [` -> preserved verbatim.
//   L8-18  charge-status (Zap->bolt, 2x2 / 1x2 / 3x40) -> ported; component web
//          ../ChargeStatusWidget (native port pending) -> placeholder.
//   L19-29 charge-status-live (Zap->bolt, 2x2 / 1x2 / 3x40) -> ported;
//          ../ChargeStatusLiveWidget pending -> placeholder.
//   L30-40 charge-history (BarChart3->analytics, 2x4 / 2x2 / 4x40) -> ported;
//          ../ChargeHistoryWidget pending -> placeholder.
//   L41-51 charge-session-chart (Zap->bolt, 2x4 / 1x2 / 4x40) -> ported;
//          ../ChargeSessionChartWidget pending -> placeholder.
//   L52-62 charge-cost-tracker (DollarSign->dollarSign, 2x2 / 1x2 / 4x40) ->
//          ported; ../ChargeCostTrackerWidget pending -> placeholder.
//   L63-73 charging-schedule (Calendar->calendar, 2x2 / 1x2 / 4x40) -> ported;
//          ../ChargingScheduleWidget EXISTS natively -> wired to the real lazy
//          import.
//   L74-84 cost-forecast (TrendingUp->trendUp, 2x4 / 1x2 / 4x40) -> ported;
//          ../CostForecastWidget pending -> placeholder.
//   L85-95 charging-optimizer (Sparkles->sparkles, 2x2 / 1x2 / 4x40) -> ported;
//          ../ChargingOptimizerWidget pending -> placeholder.
//   L96-106 wall-connector (Plug->charger, 2x4 / 1x2 / 4x40) -> ported;
//          ../WallConnectorWidget pending -> placeholder.
//   L107-117 charging-telemetry (Gauge->speedCircle, 2x2 / 1x2 / 4x40) -> ported;
//          ../ChargingTelemetryWidget pending -> placeholder.
//   L118-128 supercharger-history (Zap->bolt, 2x4 / 1x2 / 4x40) -> ported;
//          ../SuperchargerHistoryWidget pending -> placeholder.
//   L129-139 charge-plans (Clock->clock, 2x4 / 1x2 / 4x40) -> ported;
//          ../ChargePlansWidget pending -> placeholder.
//   L140-150 charging-session-detail (Zap->bolt, 2x4 / 1x2 / 4x40) -> ported;
//          ../ChargingSessionDetailWidget pending -> placeholder.
//   L151   closing `];` -> preserved.
//
// No DOM, no lucide-react, no Recharts/Leaflet, and no web UI components are
// imported — only React.lazy/createElement plus existing apps/native primitives,
// components and tokens.

import {
  createElement,
  lazy,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import { StyleSheet, View } from 'react-native';

import type { SemanticIconName } from '../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../components/ui/AppText';
import { colors, spacing } from '../../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./types so the registry stays self-contained.
interface WidgetSize {
  cols: number;
  rows: number;
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
  learnMore?: { url: string; label?: string };
}

// `icon` is retyped from lucide's LucideIcon to the repo SemanticIconName so the
// native dashboard host can render it via <SemanticIcon name={icon} />.
interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: SemanticIconName;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
  help?: WidgetHelp;
}

/* ------------------------------------------------------------------ */
/*  Native-safe "unavailable" placeholder (explicit unavailable state) */
/* ------------------------------------------------------------------ */

// Stand-in for the 12 charging widgets whose native component is not ported yet.
// React.lazy + dynamic import are native-safe, but the target modules do not
// exist, so the registry points those entries at this placeholder. Built with
// createElement (not JSX) because the required output file is a `.ts` module.
const UNAVAILABLE_LABEL = 'Widget unavailable in native';

const NativeUnavailableWidget: ComponentType<WidgetProps> =
  function NativeUnavailableWidget() {
    return createElement(
      View,
      { style: styles.unavailable },
      createElement(
        AppText,
        { variant: 'caption', tone: 'muted', style: styles.unavailableText },
        UNAVAILABLE_LABEL,
      ),
    );
  };

const UNAVAILABLE_WIDGET: LazyExoticComponent<ComponentType<WidgetProps>> =
  lazy(async () => ({ default: NativeUnavailableWidget }));

// The only charging widget with a native port today — wired to the real module,
// keeping the source's `../ChargingScheduleWidget` relative path.
const ChargingScheduleWidget: LazyExoticComponent<ComponentType<WidgetProps>> =
  lazy(() => import('../ChargingScheduleWidget'));

/* ------------------------------------------------------------------ */
/*  Registry data (ported verbatim from the source array)              */
/* ------------------------------------------------------------------ */

export const CHARGING_WIDGETS: WidgetDef[] = [
  {
    id: 'charge-status',
    name: 'Charge Status',
    description: 'Current charge state, amps, time remaining',
    icon: 'bolt',
    category: 'charging',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 3, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargeStatusWidget (native port pending)
  },
  {
    id: 'charge-status-live',
    name: 'Charge Status Live',
    description:
      'Live charging: current amps/volts/power, time remaining, energy added',
    icon: 'bolt',
    category: 'charging',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 3, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargeStatusLiveWidget (native port pending)
  },
  {
    id: 'charge-history',
    name: 'Charge History',
    description: 'Recent charging sessions chart',
    icon: 'analytics',
    category: 'charging',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargeHistoryWidget (native port pending)
  },
  {
    id: 'charge-session-chart',
    name: 'Charge Session Chart',
    description:
      'Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)',
    icon: 'bolt',
    category: 'charging',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargeSessionChartWidget (native port pending)
  },
  {
    id: 'charge-cost-tracker',
    name: 'Charge Cost Tracker',
    description:
      'Monthly charging cost breakdown: total kWh, total cost, cost per mile, vs gas savings',
    icon: 'dollarSign',
    category: 'charging',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargeCostTrackerWidget (native port pending)
  },
  {
    id: 'charging-schedule',
    name: 'Charging Schedule',
    description: 'Shows scheduled charge time, departure time, charge limit',
    icon: 'calendar',
    category: 'charging',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: ChargingScheduleWidget, // web: ../ChargingScheduleWidget (native port wired)
  },
  {
    id: 'cost-forecast',
    name: 'Cost Forecast',
    description: '6-month charging cost projection with seasonal trends',
    icon: 'trendUp',
    category: 'charging',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../CostForecastWidget (native port pending)
  },
  {
    id: 'charging-optimizer',
    name: 'Charging Optimizer',
    description:
      'Smart charging schedule: optimal time, target SOC, cost savings',
    icon: 'sparkles',
    category: 'charging',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargingOptimizerWidget (native port pending)
  },
  {
    id: 'wall-connector',
    name: 'Wall Connector',
    description:
      'Home charging stats from Tesla Wall Connector: daily kWh, session history',
    icon: 'charger',
    category: 'charging',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../WallConnectorWidget (native port pending)
  },
  {
    id: 'charging-telemetry',
    name: 'Charging Telemetry',
    description:
      'Live charging metrics: voltage, amperage, power, phases, charger type',
    icon: 'speedCircle',
    category: 'charging',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargingTelemetryWidget (native port pending)
  },
  {
    id: 'supercharger-history',
    name: 'Supercharger History',
    description:
      'Tesla Supercharger sessions: location, energy, cost from Tesla account',
    icon: 'bolt',
    category: 'charging',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../SuperchargerHistoryWidget (native port pending)
  },
  {
    id: 'charge-plans',
    name: 'Charge Plans',
    description:
      'Active charge plan, rate schedule: peak/off-peak hours with rates',
    icon: 'clock',
    category: 'charging',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargePlansWidget (native port pending)
  },
  {
    id: 'charging-session-detail',
    name: 'Charge Session Detail',
    description:
      'Last charge session power curve with SoC overlay, kWh added, peak power',
    icon: 'bolt',
    category: 'charging',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../ChargingSessionDetailWidget (native port pending)
  },
];

const styles = StyleSheet.create({
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  unavailableText: {
    textAlign: 'center',
  },
});
