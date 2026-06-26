// Native parity port of
// web/src/features/charging/components/charging-list/BatteryLevelChart.tsx.
//
// The web module renders the charging-list "Battery Level at Charge Start"
// panel: a <GlassPanel> whose section-title row carries a small amber
// BatteryCharging glyph, the title, and a muted hint, above a fixed-height
// (h-36 / sm:h-44) Recharts <BarChart> that plots one amber Bar (dataKey
// "count", name "Sessions", fill #f59e0b @ 0.6 opacity) against the 0-100%
// start-SOC buckets (XAxis dataKey "range"), with a YAxis, a CartesianGrid,
// and a hover Tooltip rendering the shared <ChartTooltip>.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site (the parity bundle ships
//     no i18n runtime).
//   • the lucide-react <BatteryCharging className="h-4 w-4 text-neon-amber" />
//     -> the SemanticIcon registry 'batteryCharging' glyph rendered as a small
//     inline amber AppText, preserving the icon identity and its neon-amber tint.
//   • the shared web <GlassPanel className="p-6"> -> the already-ported native
//     GlassPanel with 24px (p-6) padding.
//   • the Recharts ResponsiveContainer/BarChart/Bar/XAxis/YAxis/Tooltip stack
//     (+ chartGrid/axisTickSm/ChartTooltip) -> a native-safe horizontal bar
//     list (the same convention as the ported StatisticsPage vehicle-comparison
//     / MiniBarChart): one amber bar per start-SOC bucket scaled to the shared
//     max count (matching Recharts' auto YAxis), each labelled with its "range"
//     and its always-visible "count" (the hover-only Tooltip has no native
//     equivalent, so the counts are shown inline); the #f59e0b @ 0.6 fill and
//     the "Sessions" series name are preserved.
//   • `import type { StartLevelBucket } from './helpers'` -> inlined locally as
//     the equivalent { range: string; count: number } type because the
//     charging-list ./helpers module is not yet ported into the native bundle.
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined ./helpers StartLevelBucket ───────────────────────────────── */

// web `import type { StartLevelBucket } from './helpers'` — each bucket is a
// 0-100% start-SOC range with the number of charging sessions that started in it.
interface StartLevelBucket {
  range: string;
  count: number;
}

// web Bar fill="#f59e0b" fillOpacity={0.6} -> the same amber at 0.6 opacity.
const BAR_FILL = 'rgba(245, 158, 11, 0.6)';

interface BatteryLevelChartProps {
  data: StartLevelBucket[];
}

export function BatteryLevelChart({data}: BatteryLevelChartProps) {
  const {t} = useTranslation();

  const buckets = data ?? [];
  // Recharts auto-scales the YAxis to the tallest bar; mirror that with a shared
  // max so every bar's width is proportional to the busiest bucket.
  const max = Math.max(...buckets.map(b => b.count ?? 0), 1);
  // lucide BatteryCharging -> the SemanticIcon registry glyph, tinted neon-amber.
  const iconGlyph = getSemanticIconDefinition('batteryCharging').glyph;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.icon} weight="bold">
          {iconGlyph}
        </AppText>
        <AppText style={styles.title} weight="semibold">
          {t('charging.charts.batteryLevelAtStart', 'Battery Level at Charge Start')}
        </AppText>
        <AppText style={styles.hint} tone="muted" variant="caption">
          {t(
            'charging.charts.batteryLevelHint',
            'How low do you typically go before charging?',
          )}
        </AppText>
      </View>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Sessions by battery level at charge start, ${buckets.length} buckets`}
        style={styles.chart}>
        {buckets.map(bucket => {
          const count = bucket.count ?? 0;
          const width: DimensionValue =
            count > 0 ? `${Math.max((count / max) * 100, 2)}%` : '0%';
          return (
            <View key={bucket.range} style={styles.row}>
              <AppText
                numberOfLines={1}
                style={styles.rowLabel}
                tone="muted"
                variant="caption">
                {bucket.range}
              </AppText>
              <View style={styles.track}>
                <View style={[styles.fill, {width}]} />
              </View>
              <AppText style={styles.rowValue} variant="caption" weight="semibold">
                {count}
              </AppText>
            </View>
          );
        })}
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: 16,
  },
  icon: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0.2,
  },
  hint: {
    marginLeft: spacing.sm,
  },
  chart: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLabel: {
    width: 64,
  },
  track: {
    flex: 1,
    height: 12,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: BAR_FILL,
  },
  rowValue: {
    width: 32,
    textAlign: 'right',
    color: colors.textPrimary,
  },
});
