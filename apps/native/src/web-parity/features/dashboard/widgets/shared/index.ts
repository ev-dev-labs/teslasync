// Native parity port of web/src/features/dashboard/widgets/shared/index.ts.
//
// Barrel module for the dashboard "shared widget" primitives. The web file is a
// pure re-export aggregator: 12 lines, each surfacing one shared widget
// component together with its public data type(s) — WidgetEventFeed/
// EventFeedItem (L1), WidgetGaugeHero/GaugeHeroConfig/GaugeHeroStat (L2),
// WidgetStatGrid/StatGridItem (L3), WidgetChartSummary/ChartSummaryStat (L4),
// WidgetDetailCard/DetailEntry (L5), WidgetRankedList/RankedItem (L6),
// WidgetComparisonCard/ComparisonMetric (L7), WidgetBigNumber (L8, component
// only), WidgetMapView (L9, component only), WidgetStatusGrid/StatusCell (L10),
// WidgetTipCards/TipItem (L11) and WidgetFlowDiagram/FlowNode/FlowArrow (L12).
//
// The export SURFACE (24 names: 12 components + 12 data types) is reproduced
// verbatim so any importer of './shared' resolves the same symbols. How each
// half is realised on React Native (contract rules 4, 5, 6 & 7):
//
//   - The 12 data types are pure TypeScript contracts with no browser
//     dependency, so they are ported 1:1 from each sibling widget source
//     (field names, optionality and unions identical). Web `ReactNode` icon /
//     children fields map to react's `ReactNode` (valid in RN). They are the
//     durable, reusable half of this barrel and are exported faithfully.
//
//   - The 12 widget COMPONENTS have no shared module in the native parity tree.
//     By the established native architecture every consumer inlines a tailored,
//     native-safe copy of just the shared-widget subset it needs (see the
//     inlined WidgetEventFeed in AlertFeedWidget/VampireDrainWidget, the inlined
//     WidgetStatGrid in DashboardStatsWidget/ChargingTelemetryWidget, the
//     inlined WidgetChartSummary in DriveTelemetryWidget/ChargeHistoryWidget,
//     the inlined WidgetGaugeHero in RegenEfficiencyWidget/SleepEfficiencyWidget,
//     the inlined WidgetRankedList + WidgetBigNumber in SuperchargerHistoryWidget,
//     the inlined WidgetDetailCard in WarrantyStatusWidget, etc.). Nothing in the
//     native tree imports this barrel, and the shared widgets' web building
//     blocks are unavailable here: StatCard / TimelineItem / Badge /
//     AnimatedNumber / Delta have no shared native module (each consumer ports
//     them inline), recharts `RadialGauge` (WidgetGaugeHero) and the
//     `react-leaflet` `MapContainer` (WidgetMapView) have no native renderer,
//     and the raw `<svg>`/`<line>`/`<circle>`/`<foreignObject>` markup of
//     WidgetFlowDiagram needs an SVG renderer this app does not depend on.
//     Re-implementing all 12 here would duplicate every consumer's inline port
//     behind base components that do not exist. So — mirroring the sibling
//     registry/commands.ts + registry/telemetry.ts precedent (lazy widgets that
//     are not present resolve to a native-safe UnavailableNotice) — each of the
//     12 component exports is a native-safe placeholder, fully typed with the
//     web component's prop contract, that renders an explicit "renders inline in
//     each native consumer (no shared module)" notice. The real visual intent is
//     preserved by the per-consumer inline ports, not by this unused barrel.
//
// This file is `.ts` (not `.tsx`), so — exactly like registry/commands.ts — the
// placeholder is built with `React.createElement` rather than JSX. No DOM-only
// modules, HTML elements, react-i18next, lucide-react, Recharts, Leaflet, or
// web @/ UI components are imported — only react + react-native primitives and
// the shared native SemanticIcon / AppText / theme tokens.

import React, {type ComponentType, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

/* ── Exported data-type contracts (ported 1:1 from the sibling widgets) ── */

// web ./WidgetEventFeed L7-18
export interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
  /** Optional navigation target. When set, the entire row becomes a drill-through link. */
  href?: string;
}

// web ./WidgetGaugeHero L4-10
export interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

// web ./WidgetGaugeHero L12-16
export interface GaugeHeroStat {
  label: string;
  value: string | number;
  unit?: string;
}

// web ./WidgetStatGrid L6-14
export interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

// web ./WidgetChartSummary L5-9
export interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

// web ./WidgetDetailCard L6-11
export interface DetailEntry {
  label: string;
  value: string | number | null;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  mono?: boolean;
}

// web ./WidgetRankedList L6-13
export interface RankedItem {
  id: string | number;
  label: string;
  value: number;
  formattedValue: string;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  barColor?: string;
}

// web ./WidgetComparisonCard L4-11
export interface ComparisonMetric {
  label: string;
  current: number;
  previous: number;
  formattedCurrent: string;
  unit?: string;
  higherIsBetter?: boolean;
}

// web ./WidgetStatusGrid L5-11
export interface StatusCell {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'inactive' | 'unknown';
  value?: string;
  icon?: ReactNode;
}

// web ./WidgetTipCards L6-13
export interface TipItem {
  id: string | number;
  icon?: ReactNode;
  title: string;
  description: string;
  impact?: 'high' | 'medium' | 'low';
  impactLabel?: string;
}

// web ./WidgetFlowDiagram L6-13
export interface FlowNode {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  icon?: ReactNode;
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

// web ./WidgetFlowDiagram L15-21
export interface FlowArrow {
  from: string;
  to: string;
  value: number;
  active: boolean;
  color?: string;
}

/* ── Native-safe prop contracts (mirror each web component's props verbatim) ── */

interface WidgetEventFeedProps {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

interface WidgetGaugeHeroProps {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
  children?: ReactNode;
}

interface WidgetStatGridProps {
  stats: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}

interface WidgetChartSummaryProps {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
}

interface WidgetDetailCardProps {
  entries: DetailEntry[];
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

interface WidgetRankedListProps {
  items: RankedItem[];
  maxItems?: number;
  compact?: boolean;
  showBars?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

interface WidgetComparisonCardProps {
  metrics: ComparisonMetric[];
  compact?: boolean;
}

interface WidgetBigNumberProps {
  value: number | null;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
}

interface WidgetMapViewProps {
  center: [number, number];
  zoom?: number;
  compact?: boolean;
  children?: ReactNode;
  // Web passes a DOM className; inert in native, kept only for prop-shape parity.
  className?: string;
  emptyMessage?: string;
  isEmpty?: boolean;
}

interface WidgetStatusGridProps {
  cells: StatusCell[];
  cols?: 2 | 3 | 4;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

interface WidgetTipCardsProps {
  tips: TipItem[];
  maxTips?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

interface WidgetFlowDiagramProps {
  nodes: FlowNode[];
  arrows: FlowArrow[];
  compact?: boolean;
  emptyMessage?: string;
}

/* ── Native-safe placeholder (the shared widgets live inline in each consumer) ── */

function SharedWidgetUnavailable({label}: {label: string}) {
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
      `${label} renders inline in each native consumer (no shared module)`,
    ),
  );
}

export const WidgetEventFeed: ComponentType<WidgetEventFeedProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetEventFeed'});

export const WidgetGaugeHero: ComponentType<WidgetGaugeHeroProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetGaugeHero'});

export const WidgetStatGrid: ComponentType<WidgetStatGridProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetStatGrid'});

export const WidgetChartSummary: ComponentType<WidgetChartSummaryProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetChartSummary'});

export const WidgetDetailCard: ComponentType<WidgetDetailCardProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetDetailCard'});

export const WidgetRankedList: ComponentType<WidgetRankedListProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetRankedList'});

export const WidgetComparisonCard: ComponentType<WidgetComparisonCardProps> =
  () =>
    React.createElement(SharedWidgetUnavailable, {label: 'WidgetComparisonCard'});

export const WidgetBigNumber: ComponentType<WidgetBigNumberProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetBigNumber'});

export const WidgetMapView: ComponentType<WidgetMapViewProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetMapView'});

export const WidgetStatusGrid: ComponentType<WidgetStatusGridProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetStatusGrid'});

export const WidgetTipCards: ComponentType<WidgetTipCardsProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetTipCards'});

export const WidgetFlowDiagram: ComponentType<WidgetFlowDiagramProps> = () =>
  React.createElement(SharedWidgetUnavailable, {label: 'WidgetFlowDiagram'});

const styles = StyleSheet.create({
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
  },
  unavailableLabel: {
    textAlign: 'center',
  },
});
