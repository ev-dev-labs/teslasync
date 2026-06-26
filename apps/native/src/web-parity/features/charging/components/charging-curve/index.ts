/**
 * Native parity barrel for
 * web/src/features/charging/components/charging-curve/index.ts.
 *
 * The web module is a pure re-export barrel that forwards nine default-exported
 * charging-curve building blocks. Every sibling is a DOM + Recharts (SVG) chart
 * or a Tailwind/web-UI panel that has not yet been ported to its own native file,
 * so this barrel preserves the identical public export surface by exposing
 * native-safe placeholder components. Each placeholder renders an explicit
 * "native port pending" state through the shared GlassPanel + AppText primitives
 * instead of importing any browser-only module (no DOM, Recharts, Leaflet, or web
 * UI). When a sibling gains a dedicated native port, replace its placeholder below
 * with a re-export of that file.
 */

import React, {type ReactElement} from 'react';
import {StyleSheet, View} from 'react-native';

import {colors, spacing} from '../../../../../theme/tokens';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';

/**
 * Permissive structural stand-ins for the web prop types. The real domain types
 * (ChargingSession, SummaryStats, the generated curve / yearly-trend points) live
 * in the not-yet-ported `./types` + `./helpers` siblings; these accept the same
 * prop names so call sites compile unchanged, and the placeholder bodies ignore
 * the values until each section is fully ported.
 */
type ObjectLike = Readonly<Record<string, unknown>>;

interface SummaryStatsGridProps {
  stats?: ObjectLike | null;
}
interface SessionCurveChartProps {
  curveData?: ReadonlyArray<ObjectLike>;
}
interface SessionDetailPanelProps {
  session?: ObjectLike | null;
}
interface SessionComparisonChartProps {
  sessions?: ReadonlyArray<ObjectLike>;
}
interface ChargerTypeChartProps {
  sessions?: ReadonlyArray<ObjectLike>;
}
interface SpeedTrendChartProps {
  sessions?: ReadonlyArray<ObjectLike>;
}
interface TimeToChargeSectionProps {
  sessions?: ReadonlyArray<ObjectLike>;
}
interface YearlyTrendChartProps {
  yearlyTrend?: ReadonlyArray<ObjectLike>;
}

type PlaceholderComponent<P> = (props: P) => ReactElement;

const KICKER_LABEL = 'Charging curve';
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

export const SummaryStatsGrid: PlaceholderComponent<SummaryStatsGridProps> = () =>
  renderPlaceholder('Summary stats');

export const SessionCurveChart: PlaceholderComponent<SessionCurveChartProps> = () =>
  renderPlaceholder('Session curve chart');

export const SessionDetailPanel: PlaceholderComponent<SessionDetailPanelProps> = () =>
  renderPlaceholder('Session detail');

export const SessionComparisonChart: PlaceholderComponent<
  SessionComparisonChartProps
> = () => renderPlaceholder('Session comparison chart');

export const ChargerTypeChart: PlaceholderComponent<ChargerTypeChartProps> = () =>
  renderPlaceholder('Charger type chart');

export const SpeedTrendChart: PlaceholderComponent<SpeedTrendChartProps> = () =>
  renderPlaceholder('Speed trend chart');

export const TimeToChargeSection: PlaceholderComponent<
  TimeToChargeSectionProps
> = () => renderPlaceholder('Time to charge');

export const YearlyTrendChart: PlaceholderComponent<YearlyTrendChartProps> = () =>
  renderPlaceholder('Yearly trend chart');

export function LoadingSkeleton(): ReactElement {
  return React.createElement(GlassPanel, {
    style: styles.panel,
    children: [
      React.createElement(View, {
        key: 'bar-wide',
        style: [styles.skeletonBar, styles.skeletonBarWide],
      }),
      React.createElement(View, {key: 'bar', style: styles.skeletonBar}),
      React.createElement(View, {
        key: 'bar-narrow',
        style: [styles.skeletonBar, styles.skeletonBarNarrow],
      }),
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
});
