// Native parity port of
// web/src/features/charging/components/charging-list/CostHeatmap.tsx.
//
// Preserves the charging cost heatmap: the 7-day x 24-hour grid, the per-cell
// intensity colouring (rgba ramp from `(1-intensity)*green` toward
// `intensity*red`), the alpha ramp `min(0.9, 0.15 + sessions*0.12)`, the empty
// `rgba(255,255,255,0.02)` cell, the maxCost fallback `peakCostPerKwh || 0.30`,
// the hour-label `i % 3 === 0` thinning, the Sun..Sat day labels, the cheap ->
// expensive legend swatches (the same rgba formula at fixed opacities), and the
// per-cell tooltip text. State/derived names (heatmap, peakCostPerKwh, maxCost,
// entry, sessions, cost, intensity, dayLabel, dayIdx, hourIdx) are kept.
//
// Native adaptations vs. the web source (behaviour / keys / units kept):
//   - react-i18next useTranslation (web L1/L13) -> native-safe t(key, fallback)
//     via useNativeTranslationFallback(); the three charging.optimizer.* keys
//     keep their English fallbacks.
//   - @/hooks/useFormatting formatCurrency (web L2/L14/L51) -> ported inline as
//     `${'$'}${fmtNumber(amount, decimals)}` (the web no-settings defaults:
//     currency symbol '$'); called with decimals 3 exactly as the web tooltip.
//   - lucide-react Clock (DOM SVG, web L3/L20, h-4 w-4 text-neon-purple) ->
//     the SemanticIcon 'clock' glyph ('CK') rendered inline via AppText and
//     tinted with the violet token (neon-purple), decorative for a11y.
//   - @/components/ui GlassPanel (web L4/L18) -> native GlassPanel; p-6 -> 24.
//   - ChargingOptimizerData['weekly_heatmap'] (web L5/L8) -> the inline
//     OptimizerHeatmapEntry[] type (sibling native types not yet converted),
//     ported from web/src/types/charging.ts.
//   - overflow-x-auto (web L23) -> a horizontal ScrollView; min-w-[600px]
//     (web L24) -> the inner grid width 600 so the 24 flex cells size evenly.
//   - the web inline `style={{ backgroundColor }}` (web L46-50/L62) stays an
//     inline dynamic style (computed rgba), the only RN-allowed inline-style
//     case; all static layout moves to StyleSheet.
//   - the web `title` hover tooltip (web L51) -> per-cell accessibilityLabel
//     carrying the same "Day H:00 — N sessions, $cost/kWh" / "Day H:00" text.
//   - text colours: text-white -> AppText primary tone; text-[var(--text-muted)]
//     -> AppText muted tone (colors.textMuted).
//   - `heatmap.find(...)` is guarded with `heatmap ?? []` (native null-safety)
//     without changing behaviour for the declared non-null array.
// See the .parity.json sidecar for the line-by-line source map.

import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

// ---- Native-safe i18n fallback (web react-i18next useTranslation L1) ---------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// ---- Native-safe currency formatting (web useFormatting().formatCurrency) ----
// Ported from web/src/hooks/useFormatting.ts: `${currencySymbol}${fmtNumber(
// amount, decimals)}`. This parity tree has no settings wiring, so the
// no-settings currency symbol '$' is used; the heatmap tooltip always passes an
// explicit decimals (3), matching the web call.

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;
const DEFAULT_CURRENCY_SYMBOL = '$';

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = DEFAULT_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function formatCurrency(amount: number, decimals = DEFAULT_PRECISION): string {
  return `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`;
}

// ---- Types (ported from web/src/types/charging.ts OptimizerHeatmapEntry) -----

interface OptimizerHeatmapEntry {
  day: number;
  hour: number;
  sessions: number;
  avg_cost_per_kwh: number;
}

// ---- Per-cell colour ramp (web L46-50) --------------------------------------
// sessions > 0: green-to-red rgba ramp by intensity with an alpha that grows
// with the session count; empty cells use the faint white wash.

function cellBackground(sessions: number, intensity: number): string {
  if (sessions > 0) {
    const r = Math.round(intensity * 239);
    const g = Math.round((1 - intensity) * 187);
    const b = Math.round((1 - intensity) * 100);
    const a = Math.min(0.9, 0.15 + sessions * 0.12);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return 'rgba(255,255,255,0.02)';
}

// ---- Legend swatch colour (web L62) -----------------------------------------
// The same rgba ramp at a fixed 0.6 opacity for the cheap -> expensive scale.

function legendSwatchBackground(o: number): string {
  return `rgba(${Math.round(o * 239)}, ${Math.round((1 - o) * 187)}, ${Math.round(
    (1 - o) * 100,
  )}, 0.6)`;
}

// web lucide Clock (L3/L20) -> SemanticIcon 'clock' glyph, tinted violet below.
const CLOCK_GLYPH = getSemanticIconDefinition('clock').glyph;

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const HOURS = Array.from({length: 24}, (_unused, i) => i);
const LEGEND_OPACITIES = [0.15, 0.3, 0.5, 0.7, 0.9] as const;

// ---- Props (web CostHeatmapProps L7-10) -------------------------------------

interface CostHeatmapProps {
  heatmap: OptimizerHeatmapEntry[];
  peakCostPerKwh: number;
}

export function CostHeatmap({
  heatmap,
  peakCostPerKwh,
}: CostHeatmapProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const maxCost = peakCostPerKwh || 0.3;
  const entries = heatmap ?? [];

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.headingRow}>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.headingGlyph}
          weight="bold">
          {CLOCK_GLYPH}
        </AppText>
        <AppText style={styles.headingText} weight="semibold">
          {t('charging.optimizer.heatmap', 'Charging Cost Heatmap')}
        </AppText>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.grid}>
          {/* Hour labels */}
          <View style={styles.hourLabelsRow}>
            {HOURS.map(i => (
              <AppText
                key={i}
                numberOfLines={1}
                style={styles.hourLabel}
                tone="muted">
                {i % 3 === 0 ? `${i}` : ''}
              </AppText>
            ))}
          </View>

          {/* Grid rows */}
          {DAY_LABELS.map((dayLabel, dayIdx) => (
            <View key={dayIdx} style={styles.dayRow}>
              <AppText numberOfLines={1} style={styles.dayLabel} tone="muted">
                {dayLabel}
              </AppText>
              {HOURS.map(hourIdx => {
                const entry = entries.find(
                  e => e.day === dayIdx && e.hour === hourIdx,
                );
                const sessions = entry?.sessions ?? 0;
                const cost = entry?.avg_cost_per_kwh ?? 0;
                const intensity = maxCost > 0 ? Math.min(1, cost / maxCost) : 0;
                const label =
                  sessions > 0
                    ? `${dayLabel} ${hourIdx}:00 — ${sessions} sessions, ${formatCurrency(
                        cost,
                        3,
                      )}/kWh`
                    : `${dayLabel} ${hourIdx}:00`;
                return (
                  <View
                    key={hourIdx}
                    accessibilityLabel={label}
                    style={[
                      styles.cell,
                      {backgroundColor: cellBackground(sessions, intensity)},
                    ]}
                  />
                );
              })}
            </View>
          ))}

          {/* Legend */}
          <View style={styles.legendRow}>
            <AppText style={styles.legendText} tone="muted">
              {t('charging.optimizer.cheap', 'Cheap')}
            </AppText>
            <View style={styles.legendSwatches}>
              {LEGEND_OPACITIES.map((o, i) => (
                <View
                  key={i}
                  style={[
                    styles.legendSwatch,
                    {backgroundColor: legendSwatchBackground(o)},
                  ]}
                />
              ))}
            </View>
            <AppText style={styles.legendText} tone="muted">
              {t('charging.optimizer.expensive', 'Expensive')}
            </AppText>
          </View>
        </View>
      </ScrollView>
    </GlassPanel>
  );
}

const PANEL_PADDING = 24;
const GRID_WIDTH = 600;
const HOUR_LABEL_OFFSET = 48;
const CELL_GAP = 2;
const CELL_RADIUS = 2;
const DAY_LABEL_WIDTH = 40;
const DAY_LABEL_MARGIN_RIGHT = 4;
const LEGEND_SWATCH_SIZE = 12;

const styles = StyleSheet.create({
  cell: {
    aspectRatio: 1,
    borderRadius: CELL_RADIUS,
    flex: 1,
  },
  dayLabel: {
    fontSize: 10,
    lineHeight: 14,
    marginRight: DAY_LABEL_MARGIN_RIGHT,
    textAlign: 'right',
    width: DAY_LABEL_WIDTH,
  },
  dayRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: CELL_GAP,
    marginBottom: 2,
  },
  grid: {
    width: GRID_WIDTH,
  },
  headingGlyph: {
    color: colors.violet,
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 18,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  headingText: {
    fontSize: 14,
    lineHeight: 20,
  },
  hourLabel: {
    flex: 1,
    fontSize: 8,
    lineHeight: 10,
    textAlign: 'center',
  },
  hourLabelsRow: {
    flexDirection: 'row',
    gap: CELL_GAP,
    marginBottom: 4,
    marginLeft: HOUR_LABEL_OFFSET,
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  legendSwatch: {
    borderRadius: CELL_RADIUS,
    height: LEGEND_SWATCH_SIZE,
    width: LEGEND_SWATCH_SIZE,
  },
  legendSwatches: {
    flexDirection: 'row',
    gap: CELL_GAP,
  },
  legendText: {
    fontSize: 10,
    lineHeight: 14,
  },
  panel: {
    padding: PANEL_PADDING,
  },
});
