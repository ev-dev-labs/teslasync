/**
 * Native parity barrel for
 * web/src/features/charging/components/cost-analysis/index.ts.
 *
 * The web module is a pure re-export barrel that forwards twelve named
 * cost-analysis building blocks (CostSummaryCards, MonthlyCostChart,
 * CostPerKwhChart, ChargerTypeBreakdown, SavingsCalculator, MonthlyCostTable,
 * TimeOfUseAnalysis, CostForecastSection, ForecastDetails, LifetimeSummary,
 * EnvironmentalImpact, LoadingSkeleton). This barrel preserves that identical
 * public export surface — all twelve identifiers, in source order.
 *
 * `ChargerTypeBreakdown` already has a dedicated native port in this directory,
 * so it is re-exported verbatim from './ChargerTypeBreakdown'. The other eleven
 * siblings are DOM + Recharts (SVG) charts, web-UI tables, or Tailwind panels
 * that have not yet been ported to their own native files, so this barrel
 * exposes native-safe placeholder components that render an explicit
 * "native port pending" state through the shared GlassPanel + AppText
 * primitives instead of importing any browser-only module (no DOM, Recharts,
 * Leaflet, or web UI). When a sibling gains a dedicated native port, replace its
 * placeholder below with a re-export of that file (as done for
 * ChargerTypeBreakdown).
 */

import React, {type ReactElement} from 'react';
import {StyleSheet, View} from 'react-native';

import {colors, spacing} from '../../../../../theme/tokens';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';

// The real native port — re-exported verbatim to preserve actual behaviour.
export {ChargerTypeBreakdown} from './ChargerTypeBreakdown';

/**
 * Permissive structural stand-ins for the web prop types. The real domain types
 * (CoreStats, MonthlyBucket, GasComparison, HourBucket, TouInsights,
 * CostForecastData, LifetimeMetrics) live in the not-yet-ported `./types` +
 * `./helpers` siblings; these accept the same prop names so call sites compile
 * unchanged, and the placeholder bodies ignore the values until each section is
 * fully ported. All props are optional so any call site compiles regardless of
 * which fields it passes.
 */
type ObjectLike = Readonly<Record<string, unknown>>;

interface CostSummaryCardsProps {
  coreStats?: ObjectLike | null;
  gasPrice?: number;
  distanceUnit?: string;
  isMiles?: boolean;
}
interface MonthlyCostChartProps {
  data?: ReadonlyArray<ObjectLike>;
  vehicleId?: number | null;
}
interface CostPerKwhChartProps {
  data?: ReadonlyArray<{date: string; costPerKwh: number}>;
}
interface SavingsCalculatorProps {
  gasComparison?: ObjectLike | null;
  gasPrice?: number;
  mpg?: number;
  electricityRate?: number;
  onGasPriceChange?: (v: number) => void;
  onMpgChange?: (v: number) => void;
  onElectricityRateChange?: (v: number) => void;
  distanceUnit?: string;
}
interface MonthlyCostTableProps {
  data?: ReadonlyArray<ObjectLike>;
}
interface TimeOfUseAnalysisProps {
  hourlyData?: ReadonlyArray<ObjectLike>;
  touInsights?: ObjectLike | null;
}
interface CostForecastSectionProps {
  forecastData?: ObjectLike;
}
interface ForecastDetailsProps {
  forecastData?: ObjectLike;
}
interface LifetimeSummaryProps {
  lifetimeMetrics?: ObjectLike | null;
  coreStats?: ObjectLike | null;
}
interface EnvironmentalImpactProps {
  coreStats?: ObjectLike | null;
}

type PlaceholderComponent<P> = (props: P) => ReactElement;

const KICKER_LABEL = 'Cost analysis';
const UNAVAILABLE_HINT = 'Native port pending';

function renderPlaceholder(section: string): ReactElement {
  return React.createElement(GlassPanel, {
    style: styles.panel,
    children: [
      React.createElement(
        AppText,
        {key: 'kicker', variant: 'caption', tone: 'muted', style: styles.kicker},
        KICKER_LABEL,
      ),
      React.createElement(AppText, {key: 'section', weight: 'semibold'}, section),
      React.createElement(
        AppText,
        {key: 'hint', variant: 'caption', tone: 'muted'},
        UNAVAILABLE_HINT,
      ),
    ],
  });
}

export const CostSummaryCards: PlaceholderComponent<CostSummaryCardsProps> = () =>
  renderPlaceholder('Cost summary cards');

export const MonthlyCostChart: PlaceholderComponent<MonthlyCostChartProps> = () =>
  renderPlaceholder('Monthly cost chart');

export const CostPerKwhChart: PlaceholderComponent<CostPerKwhChartProps> = () =>
  renderPlaceholder('Cost per kWh chart');

export const SavingsCalculator: PlaceholderComponent<SavingsCalculatorProps> = () =>
  renderPlaceholder('Savings calculator');

export const MonthlyCostTable: PlaceholderComponent<MonthlyCostTableProps> = () =>
  renderPlaceholder('Monthly cost table');

export const TimeOfUseAnalysis: PlaceholderComponent<TimeOfUseAnalysisProps> = () =>
  renderPlaceholder('Time of use analysis');

export const CostForecastSection: PlaceholderComponent<
  CostForecastSectionProps
> = () => renderPlaceholder('Cost forecast');

export const ForecastDetails: PlaceholderComponent<ForecastDetailsProps> = () =>
  renderPlaceholder('Forecast details');

export const LifetimeSummary: PlaceholderComponent<LifetimeSummaryProps> = () =>
  renderPlaceholder('Lifetime summary');

export const EnvironmentalImpact: PlaceholderComponent<
  EnvironmentalImpactProps
> = () => renderPlaceholder('Environmental impact');

/**
 * Native skeleton mirroring the web LoadingSkeleton's structure: a header pair,
 * a row of six metric-card bars, two chart blocks, and a few table rows —
 * rebuilt as plain View blocks so no FadeIn/Skeleton/web-UI module is imported.
 */
export function LoadingSkeleton(): ReactElement {
  return React.createElement(GlassPanel, {
    style: styles.panel,
    children: [
      React.createElement(View, {
        key: 'header-title',
        style: [styles.skeletonBar, styles.skeletonBarWide],
      }),
      React.createElement(View, {
        key: 'header-sub',
        style: [styles.skeletonBar, styles.skeletonBarNarrow],
      }),
      React.createElement(
        View,
        {key: 'cards', style: styles.cardRow},
        Array.from({length: 6}).map((_, i) =>
          React.createElement(View, {
            key: `card-${i}`,
            style: [styles.skeletonBar, styles.cardBar],
          }),
        ),
      ),
      React.createElement(View, {key: 'chart-a', style: styles.chartBlock}),
      React.createElement(View, {key: 'chart-b', style: styles.chartBlock}),
      React.createElement(
        View,
        {key: 'table', style: styles.tableBlock},
        Array.from({length: 5}).map((_, i) =>
          React.createElement(View, {
            key: `row-${i}`,
            style: styles.skeletonBar,
          }),
        ),
      ),
    ],
  });
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  kicker: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  skeletonBar: {
    height: 14,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.sm,
  },
  skeletonBarWide: {
    width: '80%',
  },
  skeletonBarNarrow: {
    width: '45%',
  },
  cardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardBar: {
    width: '30%',
    height: 40,
  },
  chartBlock: {
    height: 120,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.sm,
  },
  tableBlock: {
    gap: spacing.xs,
  },
});
