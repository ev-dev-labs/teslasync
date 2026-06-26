// Native parity port of
// web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx.
//
// Preserves the `chargerTypeStats` useMemo (grouping sessions by charger label,
// computing count / avgKw / avgKwh / avgDuration), the ChartContainer wrapper
// (title / subtitle / ariaLabel / data / dataColumns / height / exportable /
// exportFilename), every i18n key + English fallback, and the per-charger
// colour mapping (CHARGER_COLORS with CHART_COLORS[3]/[4] fallbacks).
//
// Native adaptations vs. the web source (behaviour / state / keys / units kept):
//   - `@/api/types` ChargingSession (web L3) -> native api/types ChargingSession.
//   - `@/lib/numberFormat` fmtNumber/fmtInt (web L4) -> ported inline with the
//     web global defaults (precision 2, locale en-US); fmtInt == precision 0.
//   - `@/lib/colors` CHARGER_COLORS (web L5) -> ported inline verbatim.
//   - `@/components/charts` (web L6-20): ChartContainer + CHART_COLORS come from
//     the native charts barrel (real native impls). The recharts
//     ResponsiveContainer/ComposedChart/CartesianGrid/XAxis/YAxis/Tooltip/Bar/
//     Cell SVG stack is re-expressed as native View grouped bars (the
//     BatteryHealthPage GroupedBars precedent) because SVG cartesian plots,
//     dual Y axes and hover tooltips are unavailable in React Native. The web
//     dual Y axes (kw left / kwh right) are preserved as intent by scaling each
//     series against its own max; the kWh bar keeps the web opacity 0.6.
//   - `./helpers` avg/durationMinutes/getChargerLabel (web L21) -> ported inline.
//   - `./types` ChargerTypeStats (web L22) -> ported inline.
//   - react-i18next useTranslation (web L2/L29) -> native-safe t(key, fallback).
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useMemo} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import type {ChargingSession} from '../../../../api/types';
import {ChartContainer, CHART_COLORS} from '../../../../components/charts';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- Native-safe number formatting -----------------------------------------
// Ported from web/src/lib/numberFormat.ts (fmtNumber/fmtInt). The web globals
// default to precision 2 / locale en-US until useSettings overrides them; this
// parity tree has no settings wiring, so the web defaults are used directly.

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals: number = DEFAULT_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

// ---- Charger type colours (ported from web/src/lib/colors.ts CHARGER_COLORS) -

const CHARGER_COLORS: Record<string, string> = {
  // Internal keys (Charging page)
  supercharger: '#ef4444',
  dc: '#f59e0b',
  home: '#10b981',
  // Display-name keys (CostAnalysis page)
  Home: '#10b981',
  Supercharger: '#ef4444',
  'Public DC': '#a855f7',
  'Work / L2': '#f59e0b',
  Other: '#6366f1',
};

// ---- Helpers (ported from ./helpers.ts) ------------------------------------

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function durationMinutes(startedAt: string, endedAt: string | null): number {
  if (!endedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function getChargerLabel(s: ChargingSession): string {
  if (
    s.charger_type === 'Tesla' ||
    (s.charger_type ?? '').toLowerCase().includes('tesla')
  )
    return 'Supercharger';
  if (s.charger_type) return 'DC Fast';
  if (s.peak_power_w && s.peak_power_w > 20_000) return 'DC Fast';
  return 'Home / AC';
}

// ---- Types (ported from ./types.ts) ----------------------------------------

interface ChargerTypeStats {
  label: string;
  count: number;
  avgKw: number;
  avgKwh: number;
  avgDuration: number;
}

// ---- Native bar rendering helpers ------------------------------------------

const pct = (n: number): DimensionValue => `${n}%` as DimensionValue;

function barHeight(value: number, max: number): DimensionValue {
  return pct(Math.max(4, (value / max) * 100));
}

interface ChargerTypeChartProps {
  sessions: ChargingSession[];
}

export default function ChargerTypeChart({sessions}: ChargerTypeChartProps) {
  const t = useNativeTranslationFallback();

  const chargerTypeStats = useMemo((): ChargerTypeStats[] => {
    if (!sessions.length) return [];
    const groups = new Map<string, ChargingSession[]>();
    sessions.forEach(s => {
      const label = getChargerLabel(s);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(s);
    });
    return Array.from(groups.entries()).map(
      ([label, items]): ChargerTypeStats => ({
        label,
        count: items.length,
        avgKw: avg(items.map(s => (s.peak_power_w ?? 0) / 1000)),
        avgKwh: avg(items.map(s => s.total_energy_added_wh / 1000)),
        avgDuration: avg(
          items.map(s => durationMinutes(s.started_at, s.ended_at)),
        ),
      }),
    );
  }, [sessions]);

  // Web dual Y axes: kW (left) and kWh (right) are independently scaled, so each
  // native series is normalised against its own max to preserve that intent.
  const maxKw = Math.max(1, ...chargerTypeStats.map(s => s.avgKw));
  const maxKwh = Math.max(1, ...chargerTypeStats.map(s => s.avgKwh));

  return (
    <ChartContainer
      title={t('charging.curve.chargerType', 'Charge Rate by Charger Type')}
      subtitle={t(
        'charging.curve.chargerTypeDesc',
        'Average kW and kWh per charger category',
      )}
      ariaLabel={t(
        'charging.curve.chargerType.aria',
        'Composed bar/line chart of average power and energy per charger type',
      )}
      data={chargerTypeStats.map(s => ({
        label: s.label,
        count: s.count,
        avgKw: fmtNumber(s.avgKw, 1),
        avgKwh: fmtNumber(s.avgKwh, 1),
        avgDuration: fmtInt(s.avgDuration),
      }))}
      dataColumns={[
        {key: 'label', label: t('charging.curve.col.charger', 'Charger Type')},
        {key: 'count', label: t('charging.curve.col.sessions', 'Sessions')},
        {key: 'avgKw', label: t('charging.curve.col.avgKw', 'Avg kW')},
        {key: 'avgKwh', label: t('charging.curve.col.avgKwh', 'Avg kWh')},
        {key: 'avgDuration', label: t('charging.curve.col.avgMin', 'Avg minutes')},
      ]}
      height={280}
      exportable
      exportFilename="charge-rate-by-type">
      <View style={styles.chartInner}>
        {/* Series key (web Bar name + unit: Avg Power kW / Avg Energy kWh). The
            second swatch keeps the web kWh bar's 0.6 opacity. */}
        <View style={styles.seriesKey}>
          <View style={styles.seriesKeyItem}>
            <View style={styles.seriesSwatch} />
            <AppText tone="secondary" variant="caption">
              {t('charging.curve.avgPower', 'Avg Power')} kW
            </AppText>
          </View>
          <View style={styles.seriesKeyItem}>
            <View style={[styles.seriesSwatch, styles.seriesSwatchEnergy]} />
            <AppText tone="secondary" variant="caption">
              {t('charging.curve.avgEnergy', 'Avg Energy')} kWh
            </AppText>
          </View>
        </View>

        {/* Grouped bars: replaces the recharts ComposedChart. One column per
            charger type, two bars (avgKw / avgKwh), coloured per charger. */}
        <View style={styles.barsRow}>
          {chargerTypeStats.map(entry => {
            const kwColor = CHARGER_COLORS[entry.label] ?? CHART_COLORS[3];
            const kwhColor = CHARGER_COLORS[entry.label] ?? CHART_COLORS[4];
            return (
              <View key={entry.label} style={styles.groupCol}>
                <View style={styles.groupBars}>
                  <View
                    style={[
                      styles.bar,
                      {
                        backgroundColor: kwColor,
                        height: barHeight(entry.avgKw, maxKw),
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.bar,
                      styles.barEnergy,
                      {
                        backgroundColor: kwhColor,
                        height: barHeight(entry.avgKwh, maxKwh),
                      },
                    ]}
                  />
                </View>
                <AppText
                  numberOfLines={1}
                  style={styles.groupLabel}
                  tone="muted"
                  variant="caption">
                  {entry.label}
                </AppText>
              </View>
            );
          })}
        </View>

        {/* Legend (web `mt-3 space-y-1` rows). */}
        <View style={styles.legend}>
          {chargerTypeStats.map(ct => (
            <View key={ct.label} style={styles.legendRow}>
              <View style={styles.legendLeft}>
                <View
                  style={[
                    styles.legendDot,
                    {
                      backgroundColor:
                        CHARGER_COLORS[ct.label] ?? CHART_COLORS[3],
                    },
                  ]}
                />
                <AppText tone="secondary" variant="caption">
                  {ct.label}
                </AppText>
              </View>
              <AppText tone="secondary" variant="caption">
                {fmtInt(ct.count)} {t('charging.curve.sessions', 'sessions')} ·{' '}
                {fmtNumber(ct.avgDuration)} {t('charging.curve.minAvg', 'min avg')}
              </AppText>
            </View>
          ))}
        </View>
      </View>
    </ChartContainer>
  );
}

const styles = StyleSheet.create({
  chartInner: {
    flex: 1,
    gap: spacing.sm,
  },
  seriesKey: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  seriesKeyItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  seriesSwatch: {
    backgroundColor: colors.textSecondary,
    borderRadius: 3,
    height: 10,
    width: 10,
  },
  seriesSwatchEnergy: {
    opacity: 0.6,
  },
  barsRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-around',
  },
  groupCol: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
  },
  groupBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 3,
    height: 120,
  },
  bar: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    width: 12,
  },
  barEnergy: {
    opacity: 0.6,
  },
  groupLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  legend: {
    gap: spacing.xs,
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
});
