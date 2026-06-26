// Native parity port of
// web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx.
//
// The web component is the charging-curve "Yearly Charging Speed Trend" panel:
// a ChartContainer wrapping a Recharts ComposedChart that overlays one Bar
// (DC-session count, right YAxis) with two Lines (10->80% and 20->80% average
// charge minutes, left YAxis), followed by a three-item legend, or an
// Activity-icon EmptyState when there is no data.
//
// Native adaptations (each documented in the .parity.json sidecar):
//   - react-i18next `useTranslation` (web L1) -> local native-safe
//     `useNativeTranslation()` returning t(key, fallback) = fallback; every
//     i18n key + English default is preserved verbatim.
//   - lucide-react `Activity` (web L2) -> the established 'Activity' glyph
//     stand-in (📈) used inside the empty state.
//   - `@/components/feedback` EmptyState (web L3) -> a local native EmptyState
//     (icon + message) mirroring the established EnergyProductsPage convention
//     (the web usage passes icon + message only, no title).
//   - `@/components/charts` (web L4-19): ChartContainer + CHART_COLORS + the
//     fmt/safe helpers are the native parity exports. The Recharts primitives
//     (ResponsiveContainer/ComposedChart/Bar/Line/XAxis/YAxis/CartesianGrid/
//     Tooltip) and their helpers (ChartTooltip, chartGrid, axisTickSm,
//     AREA_DEFAULTS) depend on browser DOM/SVG and have no native renderer, so
//     the composed chart becomes a native-safe per-year breakdown: each year is
//     a group of three proportional horizontal bars coloured by the identical
//     source series colours (Line stroke CHART_COLORS[0]/CHART_COLORS[2] for the
//     two minute series, Bar fill CHART_COLORS[5] at opacity 0.3 for the count),
//     the two minute series sharing one scale (the web left "Minutes" axis) and
//     the count its own scale (the web right "Sessions" axis). The exact numeric
//     values stay available through ChartContainer's accessible data table
//     (fed by the same `data` + `dataColumns`).
//   - The web legend (L110-123) keeps its literal swatch colours (#00f0ff,
//     purple-500 #a855f7, red-500 #ef4444 at opacity-30) exactly as authored.
//   - Recharts margins, bar corner radius, line dots, and the hover Tooltip are
//     visual/interaction-only details translated to StyleSheet (rounded fills)
//     or dropped (hover tooltips have no native analog; the data is surfaced via
//     the data table + per-year accessibility summaries) — all documented.

import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {CHART_COLORS, ChartContainer, fmt, safe} from '../../../../components/charts';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

interface YearlyTrendChartProps {
  yearlyTrend: {
    year: string;
    avg10to80: number;
    avg20to80: number;
    count: number;
  }[];
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback, []);
}

// Composed-chart series colours (web Bar `fill` / Line `stroke`).
const AVG_10_TO_80_COLOR = CHART_COLORS[0]; // web Line stroke={CHART_COLORS[0]}
const AVG_20_TO_80_COLOR = CHART_COLORS[2]; // web Line stroke={CHART_COLORS[2]}
const COUNT_COLOR = CHART_COLORS[5]; // web Bar fill={CHART_COLORS[5]}
const COUNT_OPACITY = 0.3; // web Bar opacity={0.3}

// Legend swatch colours (web L112/L116/L120 literal Tailwind classes).
const LEGEND_AVG_10_TO_80 = '#00f0ff'; // bg-[#00f0ff]
const LEGEND_AVG_20_TO_80 = '#a855f7'; // bg-purple-500
const LEGEND_COUNT = '#ef4444'; // bg-red-500 (rendered at opacity-30)

// lucide-react `Activity` glyph stand-in (web L2).
const GLYPH_ACTIVITY = '📈';

interface SeriesBarProps {
  color: string;
  opacity?: number;
  ratio: number;
  display: string;
}

function SeriesBar({color, opacity = 1, ratio, display}: SeriesBarProps) {
  const fillWidth = `${Math.max(
    Math.min(Number.isFinite(ratio) ? ratio : 0, 1) * 100,
    ratio > 0 ? 4 : 0,
  )}%` as const;

  return (
    <View style={styles.seriesRow}>
      <View style={styles.seriesTrack}>
        <View
          style={[
            styles.seriesFill,
            {backgroundColor: color, opacity, width: fillWidth},
          ]}
        />
      </View>
      <AppText numberOfLines={1} style={styles.seriesValue} variant="caption">
        {display}
      </AppText>
    </View>
  );
}

interface LegendItemProps {
  color: string;
  opacity?: number;
  label: string;
}

function LegendItem({color, opacity = 1, label}: LegendItemProps) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, {backgroundColor: color, opacity}]} />
      <AppText tone="secondary" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

export default function YearlyTrendChart({yearlyTrend}: YearlyTrendChartProps) {
  const t = useNativeTranslation();

  const rows = yearlyTrend ?? [];

  // The two minute series share the web left "Minutes" YAxis; the count Bar
  // lives on the web right "Sessions" YAxis, so each scale is computed apart.
  const maxMinutes = Math.max(
    ...rows.map(row => Math.max(safe(row.avg10to80), safe(row.avg20to80))),
    1,
  );
  const maxCount = Math.max(...rows.map(row => safe(row.count)), 1);

  const minutesLabel = t('charging.curve.minutes', 'Minutes');
  const sessionCountLabel = t('charging.curve.sessionCount', 'Sessions');
  const avg10to80Label = t('charging.curve.avg10to80Line', '10→80% avg');
  const avg20to80Label = t('charging.curve.avg20to80Line', '20→80% avg');
  const dcSessionsLabel = t('charging.curve.dcSessions', 'DC Sessions');

  return (
    <ChartContainer
      title={t('charging.curve.yearlyTrend', 'Yearly Charging Speed Trend')}
      subtitle={t(
        'charging.curve.yearlyTrendDesc',
        'Average time-to-charge and session count by year',
      )}
      ariaLabel={t(
        'charging.curve.yearlyTrend.aria',
        'Yearly average charge-time and session-count composed chart',
      )}
      data={rows}
      dataColumns={[
        {key: 'year', label: t('charging.curve.col.year', 'Year')},
        {
          key: 'avg10to80',
          label: t('charging.curve.col.avg10to80', '10→80% avg min'),
        },
        {
          key: 'avg20to80',
          label: t('charging.curve.col.avg20to80', '20→80% avg min'),
        },
        {key: 'count', label: t('charging.curve.col.dcSessions', 'DC Sessions')},
      ]}
      height={280}
      exportable
      exportFilename="yearly-charging-trend">
      {rows.length > 0 ? (
        <View style={styles.body}>
          <View style={styles.axisRow}>
            <AppText tone="muted" variant="caption">
              {minutesLabel}
            </AppText>
            <AppText tone="muted" variant="caption">
              {sessionCountLabel}
            </AppText>
          </View>

          <View style={styles.chart}>
            {rows.map(row => {
              const avg10 = safe(row.avg10to80);
              const avg20 = safe(row.avg20to80);
              const count = safe(row.count);

              return (
                <View
                  key={row.year}
                  accessible
                  accessibilityRole="summary"
                  accessibilityLabel={`${row.year}: ${avg10to80Label} ${fmt(
                    avg10,
                    1,
                  )} ${minutesLabel}, ${avg20to80Label} ${fmt(
                    avg20,
                    1,
                  )} ${minutesLabel}, ${dcSessionsLabel} ${fmt(count, 0)}`}
                  style={styles.yearGroup}>
                  <AppText style={styles.yearLabel} variant="caption" weight="semibold">
                    {row.year}
                  </AppText>
                  <View style={styles.series}>
                    <SeriesBar
                      color={AVG_10_TO_80_COLOR}
                      ratio={avg10 / maxMinutes}
                      display={`${fmt(avg10, 1)} min`}
                    />
                    <SeriesBar
                      color={AVG_20_TO_80_COLOR}
                      ratio={avg20 / maxMinutes}
                      display={`${fmt(avg20, 1)} min`}
                    />
                    <SeriesBar
                      color={COUNT_COLOR}
                      opacity={COUNT_OPACITY}
                      ratio={count / maxCount}
                      display={fmt(count, 0)}
                    />
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.legend}>
            <LegendItem color={LEGEND_AVG_10_TO_80} label={avg10to80Label} />
            <LegendItem color={LEGEND_AVG_20_TO_80} label={avg20to80Label} />
            <LegendItem
              color={LEGEND_COUNT}
              opacity={COUNT_OPACITY}
              label={dcSessionsLabel}
            />
          </View>
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <View style={styles.emptyState}>
          <AppText style={styles.emptyIcon} tone="muted">
            {GLYPH_ACTIVITY}
          </AppText>
          <AppText tone="muted" variant="caption">
            {t('common.noData', 'No data available')}
          </AppText>
        </View>
      )}
    </ChartContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  // web YAxis orientation="left" (Minutes) / orientation="right" (Sessions).
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chart: {
    gap: spacing.md,
  },
  yearGroup: {
    gap: spacing.xs,
  },
  yearLabel: {
    color: colors.textPrimary,
  },
  series: {
    gap: spacing.xs,
  },
  seriesRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  seriesTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4, // web Bar radius={[4, 4, 0, 0]}
    flex: 1,
    height: 8,
    overflow: 'hidden',
  },
  seriesFill: {
    borderRadius: 4,
    height: '100%',
  },
  seriesValue: {
    textAlign: 'right',
    width: 72,
  },
  // web "mt-3 flex flex-wrap gap-4".
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: spacing.md,
  },
  // web "flex items-center gap-1.5".
  legendItem: {
    alignItems: 'center',
    columnGap: 6,
    flexDirection: 'row',
  },
  // web "inline-block h-2 w-3 rounded-sm".
  legendSwatch: {
    borderRadius: 2,
    height: 8,
    width: 12,
  },
  // web EmptyState className="py-8".
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 32,
  },
  // web Activity icon className="h-8 w-8 opacity-20".
  emptyIcon: {
    fontSize: 32,
    opacity: 0.2,
  },
});
