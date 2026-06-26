// Native parity port of
// web/src/features/dashboard/widgets/registry/analytics.ts.
//
// The web module is the ANALYTICS_WIDGETS slice of the dashboard widget
// registry: a flat WidgetDef[] mapping each analytics widget id to its display
// metadata (name / description / category / size constraints), a lucide-react
// icon component, and a `React.lazy(() => import('../XxxWidget'))` factory.
// Every id, name, description, category, and numeric size constraint is
// preserved 1:1 with the source (L8-163).
//
// Two web concerns are made native-safe without altering the registry data:
//
//   - lucide-react icons (BarChart3, CalendarRange, CalendarDays, Trophy,
//     TrendingUp, Clock, AlertTriangle, GitBranch, PieChart, Calendar) are
//     React-DOM / SVG components and lucide-react is not a native dependency.
//     Each icon is mapped to the equivalent entry in the native SemanticIcon
//     vocabulary (`SemanticIconName`) — the same icon type the native widget
//     system already uses for `NativeWidgetDefinition.icon` — so the icon's
//     semantic intent is preserved and is immediately renderable in native via
//     <SemanticIcon />. The lucide -> semantic mapping is recorded in the
//     parity sidecar.
//
//   - `React.lazy(() => import('../XxxWidget'))` loads a per-widget React-DOM
//     component bundle. On native, each analytics widget is ported as its own
//     file under web-parity/features/dashboard/widgets/ and is wired into the
//     running app through the native widget registry (apps/native/src/widgets).
//     The component modules for this slice are not all present yet, and
//     statically importing a non-existent module would break the native
//     typecheck. To preserve this file's contract — a WidgetDef[] whose
//     `component` is a lazily-loaded ComponentType<WidgetProps> — while staying
//     type-safe, every entry's `component` is a `React.lazy` factory that
//     resolves to a native-safe "unavailable" placeholder carrying the widget
//     name. The lazy-loading mechanism and the
//     LazyExoticComponent<ComponentType<WidgetProps>> shape are retained
//     verbatim; this is the explicit-unavailable-state strategy.
//
// The `WidgetDef` / `WidgetProps` / `WidgetSize` / `WidgetConfig` /
// `WidgetCategory` types come from web ../types (L6), which is not part of this
// slice; they are inlined below as module-local declarations (same approach as
// the ported validateImport.ts), with `icon` re-typed to SemanticIconName.

import { createElement, lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';
import type { SemanticIconName } from '../../../../../components/icons/SemanticIcon';
import { spacing } from '../../../../../theme/tokens';

/* ─── inlined widget registry types (web ../types) ─────────────────────────── */

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

interface WidgetDef {
  id: string;
  name: string;
  description: string;
  // Web: `icon: LucideIcon`. lucide-react has no native renderer, so the icon
  // is carried as the equivalent native SemanticIcon name (see header).
  icon: SemanticIconName;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
}

/* ─── native-safe lazy component (web `React.lazy(() => import('../Xxx'))`) ─── */
// Explicit "unavailable" state for widget component bundles not present in this
// native slice; preserves the lazy-loaded ComponentType<WidgetProps> contract.

function PlaceholderWidget({ name }: { name: string }) {
  return createElement(
    View,
    { style: styles.unavailable },
    createElement(
      AppText,
      { variant: 'caption', tone: 'muted', style: styles.unavailableText },
      `${name} is not available on native yet`,
    ),
  );
}

function lazyWidget(name: string): LazyExoticComponent<ComponentType<WidgetProps>> {
  function LoadedWidget() {
    return createElement(PlaceholderWidget, { name });
  }
  LoadedWidget.displayName = `Widget(${name})`;
  return lazy(() => Promise.resolve({ default: LoadedWidget }));
}

export const ANALYTICS_WIDGETS: WidgetDef[] = [
  {
    id: 'fleet-stats',
    name: 'Fleet Stats',
    description: 'Fleet-wide metrics and totals',
    icon: 'analytics', // lucide BarChart3
    category: 'analytics',
    defaultSize: { cols: 4, rows: 2 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Fleet Stats'),
  },
  {
    id: 'fleet-stats-bar',
    name: 'Fleet Stats Bar',
    description: 'Fleet-wide: total vehicles, online count, total miles today, total energy',
    icon: 'analytics', // lucide BarChart3
    category: 'analytics',
    defaultSize: { cols: 4, rows: 2 },
    minSize: { cols: 3, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Fleet Stats Bar'),
  },
  {
    id: 'weekly-summary-card',
    name: 'Weekly Summary',
    description: 'This week vs last week: total miles, kWh, cost, efficiency',
    icon: 'calendarClock', // lucide CalendarRange
    category: 'analytics',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Weekly Summary'),
  },
  {
    id: 'weekly-digest',
    name: 'Weekly Digest',
    description: 'This week vs last week: distance, drives, energy, efficiency trends',
    icon: 'calendar', // lucide CalendarDays
    category: 'analytics',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Weekly Digest'),
  },
  {
    id: 'monthly-mileage',
    name: 'Monthly Mileage',
    description: 'Bar chart of monthly driving distance over last 12 months',
    icon: 'analytics', // lucide BarChart3
    category: 'analytics',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Monthly Mileage'),
  },
  {
    id: 'lifetime-stats',
    name: 'Lifetime Stats',
    description: 'All-time totals: distance, drives, energy, CO₂ saved, ownership days',
    icon: 'trophy', // lucide Trophy
    category: 'analytics',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Lifetime Stats'),
  },
  {
    id: 'mileage-stats',
    name: 'Mileage Stats',
    description: 'Driving averages: daily, weekly, monthly distance + milestone projection',
    icon: 'trendUp', // lucide TrendingUp
    category: 'analytics',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Mileage Stats'),
  },
  {
    id: 'state-timeline',
    name: 'State Timeline',
    description: 'Vehicle state distribution: driving, charging, asleep, idle breakdown',
    icon: 'clock', // lucide Clock
    category: 'analytics',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('State Timeline'),
  },
  {
    id: 'anomaly-detector',
    name: 'Anomaly Detector',
    description: 'Statistical outlier alerts: unusual battery, temp, or driving anomalies',
    icon: 'warning', // lucide AlertTriangle
    category: 'analytics',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Anomaly Detector'),
  },
  {
    id: 'fsm-distribution',
    name: 'State Distribution',
    description: 'Donut chart of time in each state + recent state transitions feed',
    icon: 'gitCompare', // lucide GitBranch
    category: 'analytics',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('State Distribution'),
  },
  {
    id: 'cost-breakdown',
    name: 'Cost Breakdown',
    description: 'Charging cost by source: home vs Supercharger vs destination, gas savings',
    icon: 'pieChart', // lucide PieChart (imported as PieIcon)
    category: 'analytics',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Cost Breakdown'),
  },
  {
    id: 'year-review',
    name: 'Year in Review',
    description: 'Annual recap: total miles, drives, energy, highlights, achievements',
    icon: 'calendar', // lucide Calendar
    category: 'analytics',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Year in Review'),
  },
  {
    id: 'analytics-summary',
    name: 'Analytics Summary',
    description: 'Fleet-wide snapshot: distance, efficiency, energy, cost per mile',
    icon: 'analytics', // lucide BarChart3
    category: 'analytics',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: lazyWidget('Analytics Summary'),
  },
  {
    id: 'recently-unlocked-achievements',
    name: 'Recently Unlocked',
    description: 'Most recently unlocked achievements — click to view in Lifetime Stats',
    icon: 'trophy', // lucide Trophy
    category: 'analytics',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 4 },
    component: lazyWidget('Recently Unlocked'),
  },
];

const styles = StyleSheet.create({
  unavailable: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  unavailableText: {
    textAlign: 'center',
  },
});
