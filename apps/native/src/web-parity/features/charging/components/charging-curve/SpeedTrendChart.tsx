// Native parity port of
// web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx.
//
// The web component computes a per-month average DC vs AC charge rate (kW) from
// the charging sessions and renders it as a Recharts multi-series LINE chart
// inside a `ChartContainer` (title, subtitle, aria label, exportable CSV +
// accessible data table), followed by a static two-item colour legend
// (DC Fast / AC / Home).
//
// Native-safe substitutions (documented in the parity sidecar):
//   - `@/components/charts` ChartContainer/ChartTooltip/LineChart/Line/XAxis/
//     YAxis/CartesianGrid/Tooltip/ResponsiveContainer/chartGrid/axisTickSm/
//     AREA_DEFAULTS -> a self-contained native panel: a GlassPanel header
//     (title + subtitle), a "DC Avg / AC Avg" series key, a grouped-bar trend
//     chart (one column per month with a DC bar + an AC bar — the closest RN
//     analog to the two-series line since the native recharts barrel only
//     renders an 'unavailable' placeholder and RN has no SVG line backend), an
//     accessible 3-column data table (Month / DC Avg kW / AC Avg kW, preserving
//     the web `data`/`dataColumns`), and the static legend row. Recharts hover
//     tooltips (`ChartTooltip`/`Tooltip`) are unavailable on touch, so the data
//     table carries the exact values instead.
//   - `useChartPalette()` (readonly string[]) -> the native CHART_COLORS
//     constant (the same colour-blind-safe Okabe-Ito default the web hook
//     resolves to); DC series = CHART_COLORS[0], AC series = CHART_COLORS[1],
//     matching the web line strokes (palette[0]/palette[1]).
//   - `@/lib/unitConversion` convertPowerFromSI -> inlined native-safe
//     convertPowerFromSI (SI watts -> kW = watts/1000, W = watts), verbatim.
//   - `./helpers` isDcSession + avg -> inlined verbatim (no native sibling yet).
//   - `import type { MonthlySpeed } from './types'` -> inlined local interface.
//   - react-i18next useTranslation (key + fallback) -> useNativeTranslation()
//     shim returning the fallback copy (same default-string behavior).
//   - The web CSV `exportable`/`exportFilename` download is a browser/DOM
//     feature with no core-RN file-download analog; the accessible data table
//     preserves the underlying data and the intent is noted here.
//   - The Recharts YAxis rotated "Avg kW" axis label becomes a plain caption
//     above the chart (RN has no rotated SVG axis label).

import React, {useMemo} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import type {ChargingSession} from '../../../../api/types';
import {CHART_COLORS} from '../../../../components/charts';
import {GlassPanel} from '../../../../components/ui/GlassPanel';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

// react-i18next useTranslation(): t(key, fallback) returns the fallback copy.
function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

const WATTS_PER_KILOWATT = 1000;
const DC_POWER_THRESHOLD_W = 20_000;

type PowerUnitPref = 'W' | 'kW';

// Verbatim native port of web `@/lib/unitConversion` convertPowerFromSI.
function convertPowerFromSI(watts: number, to: PowerUnitPref): number {
  switch (to) {
    case 'W':
      return watts;
    case 'kW':
      return watts / WATTS_PER_KILOWATT;
  }
}

// Verbatim native port of web `./helpers` isDcSession.
function isDcSession(s: ChargingSession): boolean {
  return !!(
    s.charger_type ||
    (s.peak_power_w && s.peak_power_w > DC_POWER_THRESHOLD_W)
  );
}

// Verbatim native port of web `./helpers` avg.
function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

// Inlined native port of web `./types` MonthlySpeed.
interface MonthlySpeed {
  month: string;
  dcAvgKw: number;
  acAvgKw: number;
}

function formatKw(value: number): string {
  return value.toLocaleString('en-US', {maximumFractionDigits: 1});
}

// Web Line strokes use the resolved palette[0]/palette[1]; the static bottom
// legend hard-codes its own swatch colours (`bg-[#00f0ff]`, `bg-emerald-500`).
const LEGEND_DC_COLOR = '#00f0ff';
const LEGEND_AC_COLOR = '#10b981';
const FALLBACK_DC_COLOR = '#0072B2';
const FALLBACK_AC_COLOR = '#E69F00';

const CHART_HEIGHT = 200;

/* ─── chart ────────────────────────────────────────────────────────────────── */

interface TrendBarsProps {
  data: MonthlySpeed[];
  dcColor: string;
  acColor: string;
  accessibilityLabel: string;
}

function MonthlyTrendBars({
  data,
  dcColor,
  acColor,
  accessibilityLabel,
}: TrendBarsProps) {
  const maxValue = data.reduce(
    (max, row) => Math.max(max, row.dcAvgKw, row.acAvgKw),
    0,
  );
  const hi = maxValue > 0 ? maxValue : 1;
  const yTicks = [hi, hi / 2, 0].map(formatKw);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible
      style={styles.chartFrame}>
      <View style={[styles.yAxis, {height: CHART_HEIGHT}]}>
        {yTicks.map((tick, index) => (
          <AppText
            key={`${tick}-${index}`}
            numberOfLines={1}
            style={styles.axisTick}
            tone="muted"
            variant="caption">
            {tick}
          </AppText>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={styles.barsContent}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {data.map(row => (
          <View key={row.month} style={styles.barColumn}>
            <View style={[styles.barTrack, {height: CHART_HEIGHT}]}>
              <TrendBar color={dcColor} hi={hi} value={row.dcAvgKw} />
              <TrendBar color={acColor} hi={hi} value={row.acAvgKw} />
            </View>
            <AppText
              numberOfLines={1}
              style={styles.barLabel}
              tone="muted"
              variant="caption">
              {row.month}
            </AppText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function TrendBar({
  value,
  hi,
  color,
}: {
  value: number;
  hi: number;
  color: string;
}) {
  const pct = value > 0 ? Math.max(Math.min(value / hi, 1) * 100, 3) : 0;
  return (
    <View style={styles.barSlot}>
      <View
        pointerEvents="none"
        style={[
          styles.bar,
          {backgroundColor: color, height: `${pct}%` as DimensionValue},
        ]}
      />
    </View>
  );
}

interface DataTableProps {
  rows: MonthlySpeed[];
  caption: string;
  monthLabel: string;
  dcLabel: string;
  acLabel: string;
}

function MonthlyDataTable({
  rows,
  caption,
  monthLabel,
  dcLabel,
  acLabel,
}: DataTableProps) {
  return (
    <View
      accessibilityLabel={`${caption} with ${rows.length} rows`}
      accessibilityRole="summary"
      accessible
      style={styles.tableRoot}>
      <AppText
        style={styles.tableCaption}
        tone="accent"
        variant="caption"
        weight="semibold">
        {caption}
      </AppText>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <AppText
            style={styles.tableCell}
            tone="muted"
            variant="caption"
            weight="semibold">
            {monthLabel}
          </AppText>
          <AppText
            style={[styles.tableCell, styles.numCell]}
            tone="muted"
            variant="caption"
            weight="semibold">
            {dcLabel}
          </AppText>
          <AppText
            style={[styles.tableCell, styles.numCell]}
            tone="muted"
            variant="caption"
            weight="semibold">
            {acLabel}
          </AppText>
        </View>
        {rows.map(row => (
          <View key={row.month} style={styles.tableRow}>
            <AppText style={styles.tableCell} tone="secondary" variant="caption">
              {row.month}
            </AppText>
            <AppText
              style={[styles.tableCell, styles.numCell]}
              variant="caption"
              weight="semibold">
              {formatKw(row.dcAvgKw)}
            </AppText>
            <AppText
              style={[styles.tableCell, styles.numCell]}
              variant="caption"
              weight="semibold">
              {formatKw(row.acAvgKw)}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ─── component ────────────────────────────────────────────────────────────── */

interface SpeedTrendChartProps {
  sessions: ChargingSession[];
}

export default function SpeedTrendChart({sessions}: SpeedTrendChartProps) {
  const t = useNativeTranslation();
  const palette = CHART_COLORS;

  const monthlyTrend = useMemo((): MonthlySpeed[] => {
    if (!sessions.length) {
      return [];
    }
    const byMonth = new Map<string, {dc: number[]; ac: number[]}>();
    sessions.forEach(s => {
      const month = (s.started_at ?? '').slice(0, 7);
      if (!byMonth.has(month)) {
        byMonth.set(month, {dc: [], ac: []});
      }
      const group = byMonth.get(month)!;
      const power = convertPowerFromSI(s.peak_power_w ?? 0, 'kW');
      if (isDcSession(s)) {
        group.dc.push(power);
      } else {
        group.ac.push(power);
      }
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, {dc, ac}]) => ({
        month,
        dcAvgKw: Math.round(avg(dc) * 10) / 10,
        acAvgKw: Math.round(avg(ac) * 10) / 10,
      }));
  }, [sessions]);

  const dcColor = palette[0] ?? FALLBACK_DC_COLOR;
  const acColor = palette[1] ?? FALLBACK_AC_COLOR;
  const dcSeriesLabel = t('charging.curve.dcAvg', 'DC Avg');
  const acSeriesLabel = t('charging.curve.acAvg', 'AC Avg');

  return (
    <GlassPanel padding="md" style={styles.panel}>
      <View style={styles.header}>
        <AppText variant="title" weight="semibold">
          {t('charging.curve.speedTrend', 'Charging Speed Trend')}
        </AppText>
        <AppText tone="muted" variant="caption">
          {t(
            'charging.curve.speedTrendDesc',
            'Monthly average DC vs AC charge rate',
          )}
        </AppText>
      </View>

      {monthlyTrend.length === 0 ? (
        <EmptyState
          message={t('charging.curve.speedTrend.empty', 'No charging sessions yet')}
          title={t('charging.curve.speedTrend', 'Charging Speed Trend')}
        />
      ) : (
        <>
          <View style={styles.seriesKey}>
            <View style={styles.seriesItem}>
              <View style={[styles.seriesDot, {backgroundColor: dcColor}]} />
              <AppText tone="secondary" variant="caption">
                {dcSeriesLabel}
              </AppText>
            </View>
            <View style={styles.seriesItem}>
              <View style={[styles.seriesDot, {backgroundColor: acColor}]} />
              <AppText tone="secondary" variant="caption">
                {acSeriesLabel}
              </AppText>
            </View>
          </View>

          <AppText style={styles.yLabel} tone="muted" variant="caption">
            {t('charging.curve.avgKw', 'Avg kW')}
          </AppText>

          <MonthlyTrendBars
            accessibilityLabel={t(
              'charging.curve.speedTrend.aria',
              'Monthly average DC and AC charging speed line chart',
            )}
            acColor={acColor}
            data={monthlyTrend}
            dcColor={dcColor}
          />

          <MonthlyDataTable
            acLabel={t('charging.curve.col.acAvgKw', 'AC Avg kW')}
            caption={t('charging.curve.speedTrendDesc', 'Monthly average DC vs AC charge rate')}
            dcLabel={t('charging.curve.col.dcAvgKw', 'DC Avg kW')}
            monthLabel={t('charging.curve.col.month', 'Month')}
            rows={monthlyTrend}
          />
        </>
      )}

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: LEGEND_DC_COLOR}]} />
          <AppText tone="secondary" variant="caption">
            {t('charging.curve.dcFast', 'DC Fast')}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: LEGEND_AC_COLOR}]} />
          <AppText tone="secondary" variant="caption">
            {t('charging.curve.acHome', 'AC / Home')}
          </AppText>
        </View>
      </View>
    </GlassPanel>
  );
}

SpeedTrendChart.displayName = 'SpeedTrendChart';

const styles = StyleSheet.create({
  axisTick: {
    textAlign: 'right',
  },
  bar: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    width: 12,
  },
  barColumn: {
    alignItems: 'center',
    gap: spacing.xs,
    width: 56,
  },
  barLabel: {
    maxWidth: 56,
  },
  barSlot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  barTrack: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    width: '100%',
  },
  barsContent: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  header: {
    gap: spacing.xs,
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendSwatch: {
    borderRadius: 2,
    height: 8,
    width: 12,
  },
  numCell: {
    textAlign: 'right',
  },
  panel: {
    gap: spacing.md,
  },
  seriesDot: {
    borderRadius: 6,
    height: 10,
    width: 10,
  },
  seriesItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  seriesKey: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  table: {
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableCaption: {
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tableCell: {
    flex: 1,
    minWidth: 0,
  },
  tableHeader: {
    backgroundColor: colors.surfaceSelected,
    borderTopWidth: 0,
  },
  tableRoot: {
    gap: spacing.sm,
  },
  tableRow: {
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    width: 40,
  },
  yLabel: {
    paddingHorizontal: spacing.xs,
  },
});
