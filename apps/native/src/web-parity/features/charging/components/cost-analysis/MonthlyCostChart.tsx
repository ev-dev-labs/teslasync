// Native parity port of
// web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx.
//
// The web module renders the cost-analysis "Monthly Cost Trend" panel: a shared
// <ChartContainer> (title + aria label + an exportable Month/Cost data table +
// the full annotation lifecycle keyed to scope 'cost' / chartId
// 'cost-monthly-trend' for the given vehicleId) wrapping a 260px Recharts
// <AreaChart> that plots monthly charging cost ($) against the YYYY-MM buckets as
// one gradient-filled area series in palette[0], with a CartesianGrid, a month
// XAxis (tick formatter rewriting "YYYY-MM" -> "MM/YY"), a currency YAxis
// (formatCurrency(v, 0)), a hover <ChartTooltip>, and the annotation reference
// lines from renderAnnotationLines; when there is no data it shows a full-height
// "Not enough data" placeholder.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site (the parity bundle ships
//     no i18n runtime).
//   • the shared web <ChartContainer> -> the already-ported native ChartContainer
//     (same title/ariaLabel/data/dataColumns/height/annotations API + the
//     function-children render prop), keeping the exportable Month/Cost ($) table
//     and the scope 'cost' / chartId 'cost-monthly-trend' annotation lifecycle.
//   • the Recharts ResponsiveContainer/AreaChart/Area/XAxis/YAxis/CartesianGrid/
//     Tooltip stack (+ areaGradient/AREA_DEFAULTS/chartGrid/axisTickSm/
//     ChartTooltip) -> the already-ported native <AreaChartWrapper> (the same
//     convention as the ported SessionCurveChart), which draws the same single
//     "cost" series (xKey "month", stroke/fill palette[0]) with native grid/axes
//     plus an always-visible latest-value summary because RN has no hover tooltip.
//     The XAxis tickFormatter ("YYYY-MM" -> "MM/YY") maps to the wrapper
//     xFormatter, the YAxis tickFormatter (formatCurrency(v, 0)) maps to the
//     yFormatter, the Area name "Cost ($)" maps to the series label, and the
//     areaGradient/fill="url(#costGrad)" folds into the wrapper's own alpha area
//     fill.
//   • renderAnnotationLines(chartAnnotations, (ts) => ts) -> the already-ported
//     native renderAnnotationLines (RN has no Recharts <ReferenceLine>), rendered
//     as an absolutely-positioned overlay sibling over the chart; the (ts) => ts
//     x-value mapping is preserved verbatim.
//   • web useChartPalette() -> the chart_palette settings value resolved against
//     the native CHART_COLORS (cb_safe) / NEON_COLORS barrels exactly like the
//     web resolveChartPalette (neon -> NEON_COLORS, else cb_safe), so palette[0]
//     stays the same series colour.
//   • web useFormatting().formatCurrency -> an inlined formatCurrency derived
//     from the native useSettings() query (currency_symbol + decimal_precision),
//     formatted via an inlined fmtNumber (en-US), matching web useFormatting.
//   • `import type { MonthlyBucket } from './types'` -> inlined locally because
//     the cost-analysis ./types module is not yet ported into the native bundle;
//     declared as an object-literal `type` (carrying an implicit index signature)
//     so a MonthlyBucket[] stays assignable to AreaChartWrapper's
//     Record<string, unknown>[] data prop, mirroring web cost-analysis/types.ts.
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {
  AreaChartWrapper,
  CHART_COLORS,
  ChartContainer,
  NEON_COLORS,
  renderAnnotationLines,
} from '../../../../components/charts';
import {useSettings} from '../../../../api/hooks/useSettings';

/* ─── inlined ./types MonthlyBucket ────────────────────────────────────── */

// web imports `MonthlyBucket` from ./types, which is not yet ported into the
// native web-parity bundle. Declared as an object-literal `type` (implicit index
// signature) so a MonthlyBucket[] stays assignable to AreaChartWrapper's
// Record<string, unknown>[] data prop. Only `month` and `cost` are read here; the
// remaining fields mirror web/src/features/charging/components/cost-analysis/
// types.ts verbatim.
type MonthlyBucket = {
  month: string;
  cost: number;
  energy: number;
  sessions: number;
  avgCostPerKwh: number;
  gasEquiv: number;
  savings: number;
};

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtNumber ─────────────────────────────── */

// web fmtNumber(value, decimals): locale-aware fixed-decimal formatting with
// non-finite inputs coerced to 0; web useFormatting calls it with no locale, so
// the global default 'en-US' applies.
function fmtNumber(value: number, decimals: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return safe.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safe.toFixed(decimals);
  }
}

interface MonthlyCostChartProps {
  data: MonthlyBucket[];
  vehicleId: number | null;
}

export function MonthlyCostChart({data, vehicleId}: MonthlyCostChartProps) {
  const {t} = useTranslation();
  const {data: settings} = useSettings();

  // web useChartPalette(): resolveChartPalette(chart_palette) -> neon palette when
  // the pref is 'neon', else the colour-blind-safe default. palette[0] is the area
  // stroke/fill colour.
  const palette = settings?.chart_palette === 'neon' ? NEON_COLORS : CHART_COLORS;

  // web useFormatting(): currency symbol + precision from settings, formatted via
  // fmtNumber; formatCurrency(amount, decimals) = `${symbol}${fmtNumber(...)}`.
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );

  const rows = data ?? [];
  const series = useMemo(
    () => [
      {
        key: 'cost',
        label: t('costAnalysis.charts.cost', 'Cost ($)'),
        color: palette[0],
      },
    ],
    [palette, t],
  );

  // web XAxis tickFormatter: "YYYY-MM" -> "MM/YY", passing other strings through.
  const formatMonthTick = useCallback((value: string) => {
    const parts = value.split('-');
    return parts.length === 2 ? `${parts[1]}/${parts[0].slice(2)}` : value;
  }, []);

  return (
    <ChartContainer
      title={t('costAnalysis.charts.monthlyCost', 'Monthly Cost Trend')}
      ariaLabel={t(
        'costAnalysis.charts.monthlyCost.aria',
        'Monthly charging cost trend area chart',
      )}
      data={rows.map(d => ({month: d.month, cost: d.cost}))}
      dataColumns={[
        {key: 'month', label: t('costAnalysis.charts.col.month', 'Month')},
        {key: 'cost', label: t('costAnalysis.charts.col.cost', 'Cost ($)')},
      ]}
      height={260}
      annotations={{vehicleId, scope: 'cost', chartId: 'cost-monthly-trend'}}>
      {({annotations: chartAnnotations}) =>
        rows.length > 0 ? (
          <View style={styles.chartLayer}>
            <AreaChartWrapper
              data={rows}
              xKey="month"
              series={series}
              height={260}
              xFormatter={formatMonthTick}
              yFormatter={(value: number) => formatCurrency(value, 0)}
            />
            {renderAnnotationLines(chartAnnotations, ts => ts)}
          </View>
        ) : (
          <View style={styles.empty}>
            <AppText style={styles.emptyText} tone="muted">
              {t('costAnalysis.charts.noData', 'Not enough data')}
            </AppText>
          </View>
        )
      }
    </ChartContainer>
  );
}

const styles = StyleSheet.create({
  chartLayer: {
    position: 'relative',
    width: '100%',
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
