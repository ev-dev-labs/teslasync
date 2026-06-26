// Native parity port of
// web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx.
//
// The web module renders the cost-analysis "Cost per kWh Trend" panel: a
// <GlassPanel className="p-4"> whose section-title row carries a small purple
// BarChart3 glyph and the title, above a fixed-height (260px) Recharts
// <LineChart> that plots one line series (dataKey "costPerKwh", name "$/kWh",
// stroke palette[2]) against the dated buckets (XAxis dataKey "date"), with a
// CartesianGrid, a currency-formatted YAxis (formatCurrency(v, 2)), and a hover
// Tooltip rendering the shared <ChartTooltip>; when there is no data it shows a
// centred 260px "Not enough data" placeholder.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site (the parity bundle ships
//     no i18n runtime).
//   • the lucide-react <BarChart3 className="h-4 w-4 text-purple-400" /> -> the
//     SemanticIcon registry 'analytics' glyph rendered as a small inline AppText
//     tinted violet (colors.violet ~= text-purple-400), preserving the bar-chart
//     icon identity and its purple tint.
//   • the shared web <GlassPanel className="p-4"> -> the already-ported native
//     GlassPanel with 16px (p-4) padding.
//   • the Recharts ResponsiveContainer/LineChart/Line/XAxis/YAxis/CartesianGrid/
//     Tooltip stack (+ chartGrid/axisTickSm/ChartTooltip/AREA_DEFAULTS) -> the
//     already-ported native <AreaChartWrapper> (the same convention as the ported
//     SessionCurveChart), which draws the same single "costPerKwh" series (xKey
//     "date", stroke palette[2]) with native grid/axes plus an always-visible
//     latest-value summary because RN has no hover tooltip; the YAxis
//     tickFormatter (formatCurrency(v, 2)) maps to the wrapper yFormatter, the
//     name "$/kWh" maps to the series label, and the activeDot has no native
//     equivalent (the wrapper draws its own point dots).
//   • web useChartPalette() -> the chart_palette settings value resolved against
//     the native CHART_COLORS (cb_safe) / NEON_COLORS barrels exactly like the
//     web resolveChartPalette (neon -> NEON_COLORS, else cb_safe), so palette[2]
//     stays the same series colour.
//   • web useFormatting().formatCurrency -> an inlined formatCurrency derived
//     from the native useSettings() query (currency_symbol + decimal_precision),
//     formatted via an inlined fmtNumber (en-US), matching web useFormatting.
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {
  AreaChartWrapper,
  CHART_COLORS,
  NEON_COLORS,
} from '../../../../components/charts';
import {useSettings} from '../../../../api/hooks/useSettings';

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

interface CostPerKwhChartProps {
  data: {date: string; costPerKwh: number}[];
}

export function CostPerKwhChart({data}: CostPerKwhChartProps) {
  const {t} = useTranslation();
  const {data: settings} = useSettings();

  // web useChartPalette(): resolveChartPalette(chart_palette) -> neon palette when
  // the pref is 'neon', else the colour-blind-safe default. palette[2] is the line
  // stroke colour.
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

  // lucide BarChart3 -> the SemanticIcon registry 'analytics' glyph, tinted violet.
  const iconGlyph = getSemanticIconDefinition('analytics').glyph;
  const rows = data ?? [];
  const series = useMemo(
    () => [
      {
        key: 'costPerKwh',
        label: t('costAnalysis.charts.rateLabel', '$/kWh'),
        color: palette[2],
      },
    ],
    [palette, t],
  );

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.icon} weight="bold">
          {iconGlyph}
        </AppText>
        <AppText style={styles.title} weight="semibold">
          {t('costAnalysis.charts.costPerKwh', 'Cost per kWh Trend')}
        </AppText>
      </View>
      {rows.length > 0 ? (
        <AreaChartWrapper
          data={rows}
          xKey="date"
          series={series}
          height={260}
          yFormatter={(value: number) => formatCurrency(value, 2)}
        />
      ) : (
        <View style={styles.empty}>
          <AppText style={styles.emptyText} tone="muted">
            {t('costAnalysis.charts.noData', 'Not enough data')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 16,
  },
  icon: {
    color: colors.violet,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  empty: {
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
});
