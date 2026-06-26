// Native parity port of
// web/src/features/charging/components/RateTimeline.tsx.
//
// Renders the Smart Charge Planner "rate timeline": a 24-hour TOU (time-of-use)
// bar chart where each bar's height encodes that hour's ¢/kWh rate, coloured by
// pricing tier (off-peak / mid-peak / on-peak), with the optimizer's charge
// window highlighted in cyan, a tier legend above, and 3-hourly clock labels
// below. The web file leans on browser-only dependencies that are absent from
// the native parity manifest (contract rules 4, 5 & 7); each is replaced with a
// React Native-safe equivalent and documented here + in the sidecar:
//
//   - react-i18next `useTranslation` (web L2, L35) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('key', 'English') call keeps its English default and translation-key
//     intent at each call site (chargePlanner.noRateData / .offPeak / .midPeak /
//     .onPeak / .chargeWindow).
//   - `@/lib/numberFormat` fmtNumber (web L4, L101) -> the ported native parity
//     `useFormatPrefs().fmt` (the settings-driven locale + precision formatter);
//     called as fmt(rate.rate_cents, 1) so `${...}¢/kWh` matches the web string.
//   - `@/lib/cn` (web L3, L100, L108) -> not needed: the web's conditional
//     Tailwind class merges become React Native style arrays, so tier/in-window
//     colours are selected directly without clsx/tailwind-merge.
//   - `@/types/charging` HourlyRate (web L5) -> ported inline (identical
//     snake_case shape: hour / rate_cents / tier); the native charging types
//     barrel is not imported to keep this leaf component self-contained.
//   - Tailwind utility classes + CSS custom properties (web L12-26, L54, L61-128)
//     -> StyleSheet rules. tierColors/tierTextColors Tailwind hexes are kept
//     verbatim as rgba() constants; --text-*/--surface-2/--surface-overlay/
//     --border-subtle CSS vars map onto the shared native theme tokens so the
//     light theme keeps working.
//   - CSS `:hover` tooltip (web L96-104, `hidden group-hover:block`) is
//     browser-only and has no native pointer. The faithful native analog is
//     tap-to-reveal: each bar is a Pressable that toggles a `selectedHour`
//     state, and the same tooltip body (formatHour + the tier-coloured
//     `${rate}¢/kWh`, using tierTextColors) is rendered centred above the chart.
//     Every bar also carries an accessibilityLabel with the hour + rate so the
//     data is reachable without the tap interaction.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components
// are imported -- only react, react-native primitives, the shared native
// AppText + theme tokens, and the ported parity useFormatPrefs.

import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useFormatPrefs} from '../../../components/data-display/format/_formatPrimitives';

/** Ported inline from web `@/types/charging` (identical snake_case shape). */
interface HourlyRate {
  hour: number;
  rate_cents: number;
  tier: string;
}

interface RateTimelineProps {
  rates: HourlyRate[];
  chargeWindow?: {startHour: number; endHour: number};
}

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// Total height of the bar plot (web `h-24` = 6rem = 96px). Bar heights are
// computed as pixels off this so we avoid dynamic percentage DimensionValues.
const BAR_AREA_HEIGHT = 96;

// Tailwind palette hexes used by the web classes, kept verbatim for parity.
const COLOR_EMERALD_500_40 = 'rgba(16, 185, 129, 0.4)'; // bg-emerald-500/40
const COLOR_EMERALD_500_50 = 'rgba(16, 185, 129, 0.5)'; // bg-emerald-500/50
const COLOR_AMBER_500_40 = 'rgba(245, 158, 11, 0.4)'; // bg-amber-500/40
const COLOR_RED_500_40 = 'rgba(239, 68, 68, 0.4)'; // bg-red-500/40
const COLOR_CYAN_400 = '#22d3ee'; // bg-cyan-400 (legend swatch)
const COLOR_CYAN_400_70 = 'rgba(34, 211, 238, 0.7)'; // bg-cyan-400/70 (in-window bar)
const COLOR_CYAN_400_50 = 'rgba(34, 211, 238, 0.5)'; // ring-cyan-400/50 (in-window ring)

const COLOR_EMERALD_400 = '#34d399'; // text-emerald-400
const COLOR_EMERALD_300 = '#6ee7b7'; // text-emerald-300
const COLOR_AMBER_400 = '#fbbf24'; // text-amber-400
const COLOR_RED_400 = '#f87171'; // text-red-400

// web L12-18: bg colour per pricing tier (unknown -> --surface-2 token).
const tierColors: Record<string, string> = {
  OFF_PEAK: COLOR_EMERALD_500_40,
  SUPER_OFF_PEAK: COLOR_EMERALD_500_50,
  MID_PEAK: COLOR_AMBER_500_40,
  ON_PEAK: COLOR_RED_500_40,
  unknown: colors.surfaceRaised,
};

// web L20-26: tooltip text colour per pricing tier (unknown -> --text-muted).
const tierTextColors: Record<string, string> = {
  OFF_PEAK: COLOR_EMERALD_400,
  SUPER_OFF_PEAK: COLOR_EMERALD_300,
  MID_PEAK: COLOR_AMBER_400,
  ON_PEAK: COLOR_RED_400,
  unknown: colors.textMuted,
};

// web L28-32: 24h clock label (0/24 -> "12a", 12 -> "12p", else "{h}a"/"{h-12}p").
function formatHour(h: number): string {
  if (h === 0 || h === 24) {
    return '12a';
  }
  if (h === 12) {
    return '12p';
  }
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export function RateTimeline({rates, chargeWindow}: RateTimelineProps) {
  const t = useNativeTranslation();
  const {fmt} = useFormatPrefs();
  // Native analog of the web CSS `:hover` tooltip reveal (tap to toggle).
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  const maxRate = useMemo(() => {
    if (rates.length === 0) {
      return 1;
    }
    return Math.max(...rates.map(r => r.rate_cents));
  }, [rates]);

  const isInWindow = (hour: number) => {
    if (!chargeWindow) {
      return false;
    }
    const {startHour, endHour} = chargeWindow;
    if (startHour <= endHour) {
      return hour >= startHour && hour < endHour;
    }
    // Cross-midnight window
    return hour >= startHour || hour < endHour;
  };

  if (rates.length === 0) {
    return (
      <View style={styles.emptyState}>
        <AppText style={styles.emptyText}>
          {t('chargePlanner.noRateData', 'No rate data available')}
        </AppText>
      </View>
    );
  }

  const selectedRate =
    selectedHour != null ? rates.find(r => r.hour === selectedHour) : undefined;

  return (
    <View style={styles.container}>
      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: COLOR_EMERALD_500_40}]} />
          <AppText style={styles.legendText}>
            {t('chargePlanner.offPeak', 'Off-Peak')}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: COLOR_AMBER_500_40}]} />
          <AppText style={styles.legendText}>
            {t('chargePlanner.midPeak', 'Mid-Peak')}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: COLOR_RED_500_40}]} />
          <AppText style={styles.legendText}>
            {t('chargePlanner.onPeak', 'On-Peak')}
          </AppText>
        </View>
        {chargeWindow && (
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendSwatch,
                styles.legendSwatchGlow,
                {backgroundColor: COLOR_CYAN_400},
              ]}
            />
            <AppText style={styles.legendText}>
              {t('chargePlanner.chargeWindow', 'Charge Window')}
            </AppText>
          </View>
        )}
      </View>

      {/* Tooltip (tap-to-reveal: native analog of the web hover tooltip) */}
      {selectedRate && (
        <View style={styles.tooltipWrap} pointerEvents="none">
          <View style={styles.tooltip}>
            <AppText style={styles.tooltipHour}>{formatHour(selectedRate.hour)}</AppText>
            <AppText
              style={[
                styles.tooltipRate,
                {color: tierTextColors[selectedRate.tier] ?? colors.textSecondary},
              ]}>
              {`${fmt(selectedRate.rate_cents, 1)}¢/kWh`}
            </AppText>
          </View>
        </View>
      )}

      {/* 24-hour bar chart */}
      <View style={styles.barRow}>
        {rates.map(rate => {
          const heightPct = maxRate > 0 ? (rate.rate_cents / maxRate) * 100 : 10;
          const heightPx = (Math.max(heightPct, 5) / 100) * BAR_AREA_HEIGHT;
          const inWindow = isInWindow(rate.hour);
          const baseColor = tierColors[rate.tier] ?? tierColors.unknown;

          return (
            <Pressable
              key={rate.hour}
              accessibilityRole="button"
              accessibilityLabel={`${formatHour(rate.hour)}, ${fmt(
                rate.rate_cents,
                1,
              )} cents per kWh`}
              onPress={() =>
                setSelectedHour(prev => (prev === rate.hour ? null : rate.hour))
              }
              style={styles.barColumn}>
              {/* Bar */}
              <View
                style={[
                  styles.bar,
                  inWindow
                    ? styles.barInWindow
                    : {backgroundColor: baseColor},
                  {height: heightPx},
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {/* Hour labels */}
      <View style={styles.hourLabels}>
        {rates.map(rate => (
          <View key={rate.hour} style={styles.hourLabelCell}>
            <AppText style={styles.hourLabelText}>
              {rate.hour % 3 === 0 ? formatHour(rate.hour) : ''}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // web `space-y-3` (12px vertical rhythm between sections).
  container: {
    gap: 12,
  },
  // web empty state: `text-center text-[var(--text-muted)] py-8`.
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  // web legend row: `flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]`.
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  // web swatch: `w-3 h-3 rounded-sm`.
  legendSwatch: {
    borderRadius: 2,
    height: 12,
    width: 12,
  },
  // web `shadow-[0_0_8px_rgba(34,211,238,0.5)]` cyan glow.
  legendSwatchGlow: {
    elevation: 4,
    shadowColor: COLOR_CYAN_400,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  legendText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  // Tooltip slot above the chart; web tooltip uses --surface-overlay + --border-subtle.
  tooltipWrap: {
    alignItems: 'center',
  },
  tooltip: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tooltipHour: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  tooltipRate: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web bar chart container: `flex items-end gap-0.5 h-24`.
  barRow: {
    flexDirection: 'row',
    gap: 2,
    height: BAR_AREA_HEIGHT,
    position: 'relative',
  },
  // web per-bar wrapper: `flex-1 flex flex-col items-center justify-end h-full`.
  barColumn: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  // web bar: `w-full rounded-t-sm` + dynamic height.
  bar: {
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    width: '100%',
  },
  // web in-window bar: `bg-cyan-400/70 shadow-[0_0_12px_...] ring-1 ring-cyan-400/50`.
  barInWindow: {
    backgroundColor: COLOR_CYAN_400_70,
    borderColor: COLOR_CYAN_400_50,
    borderWidth: 1,
    elevation: 6,
    shadowColor: COLOR_CYAN_400,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  // web hour labels: `flex gap-0.5 text-[10px] text-[var(--text-muted)]`.
  hourLabels: {
    flexDirection: 'row',
    gap: 2,
  },
  hourLabelCell: {
    flex: 1,
  },
  hourLabelText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
});
