// Native parity port of
// web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx.
//
// The web source renders the "Cost by Charger Type" card for the charging cost
// analysis: a GlassPanel whose `text-sm font-semibold text-white` heading pairs
// a lucide `Zap` glyph (text-yellow-400) with the title, above a responsive grid
// (1 column, 2 at Tailwind `lg`) when `data.length > 0`:
//   * LEFT  — a Recharts donut (`ResponsiveContainer`/`PieChart`/`Pie`/`Cell`/
//             `Tooltip` with `ChartTooltip`), `dataKey="cost"`, `nameKey="name"`,
//             innerRadius 60 / outerRadius 100, one `Cell` per entry coloured by
//             `entry.color` — i.e. each charger type's share of total cost.
//   * RIGHT — a legend row (colour swatch + name per entry) above a per-entry
//             breakdown: the name, `formatCurrency(cost, 2) · fmtInt(sessions)
//             sessions`, a progress bar whose width is the cost share `pct`
//             (coloured `entry.color`), and a sub-row of `fmtWithUnit(energy,
//             'kWh', 1)`, the per-kWh price (`formatCurrency(cost/energy, 3)/kWh`
//             or '—' when energy is 0), and `fmtNumber(pct, 1)%`.
// When `data.length === 0` it shows a centred "Not enough data" empty state.
//
// None of those web modules are native-safe (react-i18next is not wired; lucide,
// the DOM grid/Tailwind/CSS vars are browser-only; Recharts is a browser DOM/SVG
// renderer forbidden in native output; the shared web GlassPanel + `@/hooks/
// useFormatting` + `@/lib/numberFormat` + `./types` ports do not exist yet in
// this file-by-file loop), so — mirroring the sibling EfficiencyPanel and the
// OverviewVehicleComparison donut rebuild — this self-contained port rebuilds
// each piece with React Native primitives and the existing native tokens/
// components:
//   * GlassPanel (native) takes a `style` instead of a `className`; the web
//     `p-4` maps to padding 16.
//   * The lucide `Zap` (h-4 w-4 text-yellow-400) maps to the repo SemanticIcon
//     `bolt` ('ZP' glyph) read via getSemanticIconDefinition, rendered as a bare
//     glyph tinted yellow-400 (#facc15) to preserve the colour intent — no
//     lucide-react / DOM <svg> import.
//   * The Recharts donut is rebuilt as a native data-visible stacked share bar
//     (one colour segment per entry, width = the entry's share of total cost),
//     which conveys the donut's "proportion of the whole" intent with the same
//     per-entry colours — the same vocabulary the OverviewVehicleComparison /
//     EnergyPage donut rebuilds use. The browser-only Tooltip hover (ChartTooltip)
//     has no native analogue and is omitted; the per-entry numbers it would show
//     are already rendered verbatim in the RIGHT breakdown list.
//   * The Tailwind `grid grid-cols-1 gap-6 lg:grid-cols-2` becomes a flex layout
//     that stacks below the Tailwind lg (1024px) breakpoint and sits side-by-side
//     at/above it, with the gap-6 (24px) gutter preserved.
//   * `useFormatting().formatCurrency` is reproduced inline at the web defaults
//     (currency symbol '$', precision 2) since no native settings store is wired;
//     `fmtNumber`/`fmtInt`/`fmtWithUnit` are reproduced inline at the web global
//     locale ('en-US') with the same `safeNumber` nullish/NaN -> 0 guard.
//   * react-i18next is replaced by a self-contained fallback that preserves every
//     i18n key and English fallback string.
//   * `ChargerTypeData` (imported from `./types` on the web) is mirrored as a
//     local interface because the native `./types` port does not exist yet; the
//     field set matches the web shape exactly. This is a pure presentational
//     component — it renders already-computed values verbatim and performs no
//     unit conversion itself.
//
// No DOM, no lucide-react, no framer-motion, no Recharts/Leaflet, and no web UI
// components are imported.

import React, {useCallback} from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type DimensionValue,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';

type NativeTFunction = (key: string, fallback: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n
// runtime wired yet, so this returns the English fallback string, preserving the
// i18n key/fallback intent for the title, the "sessions" suffix and the
// empty-state message.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Local mirror of the web `./types` `ChargerTypeData` export. The native `./types`
// port does not exist yet in this file-by-file conversion loop, so the shape is
// reproduced here field-for-field to keep the port self-contained and type-checked.
interface ChargerTypeData {
  name: string;
  cost: number;
  energy: number;
  sessions: number;
  color: string;
}

export interface ChargerTypeBreakdownProps {
  data: ChargerTypeData[];
  totalCost: number;
}

// --- Inlined `@/lib/numberFormat` parity ----------------------------------
// The web default global precision is 2 and the default global locale is
// 'en-US' (both set by useSettings, which native has not wired). Non-finite
// inputs coerce to 0 via `safeNumber`, exactly as the web formatters do.
const FMT_LOCALE = 'en-US';
const FMT_PRECISION = 2;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals: number = FMT_PRECISION): string {
  const d = Math.max(0, Math.min(20, decimals));
  try {
    return safeNumber(value).toLocaleString(FMT_LOCALE, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(value).toFixed(d);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

function fmtWithUnit(value: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(value, decimals)} ${unit}`;
}

// --- Inlined `@/hooks/useFormatting` `formatCurrency` parity ---------------
// `${currencySymbol}${fmtNumber(amount, decimals)}` with the web defaults — the
// '$' currency symbol and precision 2 — since no native settings store is wired.
const CURRENCY_SYMBOL = '$';

function formatCurrency(amount: number, decimals: number = FMT_PRECISION): string {
  return `${CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`;
}

// Tailwind `lg:` breakpoint — at/above this width the donut + breakdown sit side
// by side (grid-cols-2); below it they stack (grid-cols-1).
const LG_BREAKPOINT = 1024;
// gap-6 == 1.5rem == 24px.
const GRID_GAP = 24;
// The `Zap` icon's text-yellow-400.
const YELLOW_400 = '#facc15';
// Progress / share-bar track: web `bg-[var(--surface-2)]` (#151621, dark theme).
const SURFACE_2 = '#151621';

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.max(0, Math.min(100, pct));
}

// Native rebuild of the Recharts donut: a single rounded track whose coloured
// segments are each entry's share of total cost — the donut's "proportion of the
// whole" intent, with the same per-entry colours.
function CostShareBar({data}: {data: ChargerTypeData[]}) {
  const pieTotal = data.reduce((sum, entry) => sum + safeNumber(entry.cost), 0);
  return (
    <View style={styles.donutWrap}>
      <View style={styles.shareTrack}>
        {data.map(entry => {
          const share =
            pieTotal > 0 ? (safeNumber(entry.cost) / pieTotal) * 100 : 0;
          return (
            <View
              key={entry.name}
              style={{
                width: `${clampPct(share)}%` as DimensionValue,
                backgroundColor: entry.color,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export function ChargerTypeBreakdown({data, totalCost}: ChargerTypeBreakdownProps) {
  const t = useNativeTranslationFallback();
  const {width} = useWindowDimensions();
  const twoCol = width >= LG_BREAKPOINT;
  const boltGlyph = getSemanticIconDefinition('bolt').glyph;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={[styles.titleIcon, {color: YELLOW_400}]} weight="bold">
          {boltGlyph}
        </AppText>
        <AppText style={styles.title} weight="semibold">
          {t('costAnalysis.chargerType.title', 'Cost by Charger Type')}
        </AppText>
      </View>

      {data.length > 0 ? (
        <View style={[styles.grid, twoCol ? styles.gridWide : null]}>
          {/* Donut (cost share) */}
          <View style={twoCol ? styles.gridCol : styles.gridColFull}>
            <CostShareBar data={data} />
          </View>

          {/* Detail breakdown bars */}
          <View style={twoCol ? styles.gridCol : styles.gridColFull}>
            <View style={styles.legendRow}>
              {data.map(entry => (
                <View key={entry.name} style={styles.legendItem}>
                  <View
                    style={[styles.legendSwatch, {backgroundColor: entry.color}]}
                  />
                  <AppText style={styles.legendLabel} tone="muted">
                    {entry.name}
                  </AppText>
                </View>
              ))}
            </View>

            {data.map(entry => {
              const pct =
                totalCost > 0 ? (safeNumber(entry.cost) / totalCost) * 100 : 0;
              return (
                <View key={entry.name} style={styles.entry}>
                  <View style={styles.entryHead}>
                    <AppText style={styles.entryName} tone="secondary" weight="semibold">
                      {entry.name}
                    </AppText>
                    <AppText style={styles.entryMeta} tone="muted">
                      {formatCurrency(entry.cost, 2)} · {fmtInt(entry.sessions)}{' '}
                      {t('costAnalysis.chargerType.sessions', 'sessions')}
                    </AppText>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${clampPct(pct)}%` as DimensionValue,
                          backgroundColor: entry.color,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.entryFoot}>
                    <AppText style={styles.entryFootText} tone="muted">
                      {fmtWithUnit(entry.energy, 'kWh', 1)}
                    </AppText>
                    <AppText style={styles.entryFootText} tone="muted">
                      {entry.energy > 0
                        ? `${formatCurrency(entry.cost / entry.energy, 3)}/kWh`
                        : '—'}
                    </AppText>
                    <AppText style={styles.entryFootText} tone="muted">
                      {fmtNumber(pct, 1)}%
                    </AppText>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <AppText tone="muted">
            {t('costAnalysis.charts.noData', 'Not enough data')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

ChargerTypeBreakdown.displayName = 'ChargerTypeBreakdown';

const styles = StyleSheet.create({
  // GlassPanel p-4.
  panel: {
    padding: 16,
  },
  // h3 flex items-center gap-2 mb-4.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  // The text-yellow-400 Zap glyph (h-4 w-4).
  titleIcon: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  // text-sm font-semibold text-white.
  title: {
    fontSize: 14,
    lineHeight: 20,
    color: '#ffffff',
  },
  // grid grid-cols-1 gap-6 lg:grid-cols-2.
  grid: {
    flexDirection: 'column',
    gap: GRID_GAP,
  },
  gridWide: {
    flexDirection: 'row',
  },
  gridCol: {
    flex: 1,
  },
  gridColFull: {
    width: '100%',
  },
  // The donut's centred container (web flex items-center justify-center, h 280).
  donutWrap: {
    justifyContent: 'center',
    minHeight: 48,
  },
  // Stacked cost-share track — the donut rebuild.
  shareTrack: {
    flexDirection: 'row',
    height: 20,
    borderRadius: 999,
    backgroundColor: SURFACE_2,
    overflow: 'hidden',
  },
  // space-y-3 between entries / mb-2 legend.
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 8,
  },
  // flex items-center gap-1.5.
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // h-3 w-3 rounded-full.
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  // text-xs var(--text-muted).
  legendLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  // Per-entry block (space-y-1).
  entry: {
    gap: 4,
    marginTop: 12,
  },
  // flex items-center justify-between text-xs.
  entryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  // font-medium var(--text-secondary).
  entryName: {
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  },
  // var(--text-muted) text-xs.
  entryMeta: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'right',
    flexShrink: 1,
  },
  // h-2 overflow-hidden rounded-full bg-[var(--surface-2)].
  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: SURFACE_2,
    overflow: 'hidden',
  },
  // h-full rounded-full.
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  // flex justify-between text-[10px] var(--text-muted).
  entryFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  entryFootText: {
    fontSize: 10,
    lineHeight: 14,
  },
  // flex h-[200px] items-center justify-center text-sm var(--text-muted).
  empty: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
