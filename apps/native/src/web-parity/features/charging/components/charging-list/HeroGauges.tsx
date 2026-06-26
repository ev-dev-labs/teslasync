// Native parity port of
// web/src/features/charging/components/charging-list/HeroGauges.tsx.
//
// Renders the charging-list hero GlassPanel: four RadialGauges (Sessions,
// Energy, Total Cost, Avg Power) plus an animated "Avg $/kWh" metric, or an
// empty state when no stats are available. The web file leans on browser-only
// dependencies that are absent from the native parity manifest (contract rules
// 4, 5 & 7); each is replaced with a React Native-safe equivalent and
// documented here + in the sidecar:
//
//   - react-i18next `useTranslation` (web L1, L14) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('key', 'English') call keeps its English default and translation-key
//     intent at each call site (charging.gauges.* / charging.noStats).
//   - `@/components/ui` GlassPanel (web L2, L17, L36) -> the shared native
//     GlassPanel; the className 'p-4 sm:p-6' -> the mobile-first base padding 16
//     (p-4); the sm:p-6 breakpoint has no native surface.
//   - `@/components/charts` RadialGauge (web L3, L20-23) -> the ported native
//     parity RadialGauge (same value/max/label/unit/color props; the web hardcoded
//     hexes #00f0ff / #10b981 / #f59e0b / #a855f7 are kept verbatim as constants).
//   - `@/components/data-display` AnimatedNumber (web L4, L26) -> the ported
//     native parity AnimatedNumber; the literal '$' prefix sibling is mapped to
//     its `prefix="$"` prop (identical rendered "$X.XXX") and the decimals={3}
//     easing is preserved.
//   - `@/components/feedback` EmptyState (web L5, L34) -> the shared native
//     EmptyState. The web call passes only `message` (its `title` is optional),
//     but the native EmptyState requires a `title`; following the established
//     ChartContainer parity convention a concise title key
//     (charging.noStatsTitle) is synthesized alongside the verbatim
//     charging.noStats message.
//   - `@/lib/numberFormat` fmtNumber (web L6, L22, L26) -> the ported
//     useFormatPrefs().fmt (the native parity port of numberFormat.fmtNumber with
//     the same settings-derived global locale + precision), so
//     parseFloat(fmt(v, d)) reproduces parseFloat(fmtNumber(v, d)) exactly —
//     including the pre-existing web quirk that a grouped locale string parses at
//     its first separator.
//   - `./helpers` type ChargingStats (web L7, L10) -> ported inline; the native
//     charging-list helpers are not yet ported.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported -- only react, react-native primitives, the shared native AppText /
// GlassPanel / EmptyState / theme tokens, and the ported parity RadialGauge /
// AnimatedNumber / format primitives.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {RadialGauge} from '../../../../components/charts/RadialGauge';
import {AnimatedNumber} from '../../../../components/data-display/AnimatedNumber';
import {useFormatPrefs} from '../../../../components/data-display/format/_formatPrimitives';

// Tailwind / neon palette hexes used by the web classes, kept verbatim for parity.
const COLOR_SESSIONS = '#00f0ff'; // neon cyan
const COLOR_ENERGY = '#10b981'; // emerald-500
const COLOR_COST = '#f59e0b'; // amber-500
const COLOR_AVG_POWER = '#a855f7'; // purple-500
const COLOR_EMERALD_300 = '#6ee7b7'; // text-emerald-300 (avg cost value)

// ── ./helpers type ChargingStats (ported inline; native helpers not yet present) ──
interface ChargingStats {
  totalEnergy: number;
  totalCost: number;
  totalDuration: number;
  avgPower: number;
  avgCostPerKwh: number;
  homeCount: number;
  scCount: number;
  dcCount: number;
  count: number;
}

interface HeroGaugesProps {
  stats: ChargingStats | null;
}

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

export function HeroGauges({stats}: HeroGaugesProps) {
  const t = useNativeTranslation();
  const {fmt} = useFormatPrefs();

  return (
    <GlassPanel style={styles.panel}>
      {stats ? (
        <View style={styles.grid}>
          <View style={styles.gridItem}>
            <RadialGauge
              value={stats.count}
              max={Math.max(stats.count, 50)}
              label={t('charging.gauges.sessions', 'Sessions')}
              unit=""
              color={COLOR_SESSIONS}
            />
          </View>
          <View style={styles.gridItem}>
            <RadialGauge
              value={Math.round(stats.totalEnergy)}
              max={Math.max(stats.totalEnergy, 500)}
              label={t('charging.gauges.energy', 'Energy')}
              unit="kWh"
              color={COLOR_ENERGY}
            />
          </View>
          <View style={styles.gridItem}>
            <RadialGauge
              value={parseFloat(fmt(stats.totalCost ?? 0, 0))}
              max={Math.max(stats.totalCost ?? 0, 100)}
              label={t('charging.gauges.totalCost', 'Total Cost')}
              unit="$"
              color={COLOR_COST}
            />
          </View>
          <View style={styles.gridItem}>
            <RadialGauge
              value={Math.round(stats.avgPower)}
              max={250}
              label={t('charging.gauges.avgPower', 'Avg Power')}
              unit="kW"
              color={COLOR_AVG_POWER}
            />
          </View>
          <View style={[styles.gridItem, styles.avgCostCell]}>
            <AnimatedNumber
              prefix="$"
              value={parseFloat(fmt(stats.avgCostPerKwh ?? 0, 2))}
              decimals={3}
              style={styles.avgCostValue}
            />
            <AppText style={styles.avgCostLabel}>
              {t('charging.gauges.avgCostPerKwh', 'Avg $/kWh')}
            </AppText>
          </View>
        </View>
      ) : (
        <EmptyState
          title={t('charging.noStatsTitle', 'No charging statistics')}
          message={t(
            'charging.noStats',
            'No charging statistics available yet',
          )}
        />
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 16,
  },
  grid: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
  },
  gridItem: {
    alignItems: 'center',
  },
  avgCostCell: {
    justifyContent: 'center',
  },
  avgCostValue: {
    color: COLOR_EMERALD_300,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
    textAlign: 'center',
  },
  avgCostLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.5,
    lineHeight: 14,
    marginTop: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
});
