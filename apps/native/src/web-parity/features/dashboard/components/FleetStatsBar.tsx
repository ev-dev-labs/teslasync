// Native parity port of web/src/features/dashboard/components/FleetStatsBar.tsx.
//
// The web component is the dashboard's headline metric strip: a responsive
// Tailwind grid (2 → 5 columns) of five GlassPanel stat tiles —
//   1. Fleet Size      — vehicleCount, with an "{onlineCount} online" subline.
//   2. Distance (30d)  — toDistanceDisplay(total_distance_km) + distanceUnit,
//                        under a MiniChart sparkline of recent drive distances.
//   3. Energy (30d)    — total_energy_kwh (1 decimal) + " kWh", under a MiniChart
//                        sparkline of recent charge energy.
//   4. Efficiency      — toEfficiencyDisplay(avg_efficiency_wh_km) + efficiencyUnit,
//                        with a "fleet average" subline.
//   5. Alerts          — unreadAlerts, coloured red when > 0 else emerald, with an
//                        "unread" subline.
// Each numeric value uses <AnimatedNumber> (an ease-out count-up) and i18n labels.
//
// This native port preserves that contract 1:1 — the same ten props (analytics,
// vehicleCount, onlineCount, unreadAlerts, recentDrives, recentCharges,
// toDistanceDisplay, toEfficiencyDisplay, distanceUnit, efficiencyUnit), the same
// `total_distance_km` / `total_energy_kwh` / `avg_efficiency_wh_km` reads with
// `?? 0` null-safety, the same `recent*.map(...).reverse() ?? [0]` sparkline
// series (distance_m / total_energy_added_wh), the same decimals/suffix on each
// value, the same conditional alert colour, every i18n key + English default, and
// the same five-tile structure — using React Native primitives, the existing
// native GlassPanel + AppText + design tokens, and the already-ported web-parity
// MiniChart.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the `.parity.json` sidecar:
//   - react-i18next `useTranslation('dashboard')` (web L1): no native i18next
//     runtime, so an inline `useNativeTranslationFallback()` returns
//     `t(key, fallback?) = fallback ?? key`, preserving every key + default.
//   - `@/components/data-display/AnimatedNumber` (web L4): the web span uses
//     requestAnimationFrame + performance.now ease-out; reproduced here as an
//     inline native-safe <AnimatedNumber> driving an AppText (RAF + Date.now,
//     same ease-out quad, same value/duration/decimals/prefix/suffix props,
//     tabular-nums → fontVariant). Cleans up its frame on unmount.
//   - `@/components/motion` StaggerContainer/StaggerItem (web L6): framer-motion
//     entrance/stagger has no native equivalent → static View wrappers.
//   - `@/lib/cn` (web L2): Tailwind class-merge is unused at runtime on native;
//     the lone conditional class (alert colour) becomes a conditional style.
//   - `../types` FleetAnalytics/Drive/ChargingSession (web L7): the dashboard
//     types module is not yet ported, so the relevant fields are mirrored as
//     local interfaces (the consumed subset of the web shapes).
//   - the Tailwind responsive grid (2/3/4/5 cols) collapses to a mobile-first
//     2-column wrap, matching the web base breakpoint.

import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {MiniChart} from '../../../components/charts/MiniChart';

/* ── ported: ../types (consumed subset of the web dashboard types) ────────── */

export interface FleetAnalytics {
  total_distance_km: number;
  total_energy_kwh: number;
  avg_efficiency_wh_km: number;
}

export interface Drive {
  distance_m: number;
}

export interface ChargingSession {
  total_energy_added_wh: number;
}

/* ── native translation fallback (native-safe port of react-i18next) ──────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback ?? _key;
}

/* ── native motion stand-ins (`@/components/motion`, framer-motion → static) ─ */

function StaggerContainer({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

function StaggerItem({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

/* ── AnimatedNumber (native-safe port of data-display/AnimatedNumber.tsx) ──── */

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

function fmtNumber(value: number, decimals: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return safe.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safe.toFixed(decimals);
  }
}

function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return (
    <AppText style={[styles.animatedNumber, style]} weight="bold">
      {prefix}
      {fmtNumber(display, decimals)}
      {suffix}
    </AppText>
  );
}

/* ── ported: FleetStatsBar (web L9-86) ────────────────────────────────────── */

interface FleetStatsBarProps {
  analytics: FleetAnalytics | undefined;
  vehicleCount: number;
  onlineCount: number;
  unreadAlerts: number;
  recentDrives: Drive[] | undefined;
  recentCharges: ChargingSession[] | undefined;
  toDistanceDisplay: (km: number) => number;
  toEfficiencyDisplay: (whKm: number) => number;
  distanceUnit: string;
  efficiencyUnit: string;
}

export function FleetStatsBar({
  analytics,
  vehicleCount,
  onlineCount,
  unreadAlerts,
  recentDrives,
  recentCharges,
  toDistanceDisplay,
  toEfficiencyDisplay,
  distanceUnit,
  efficiencyUnit,
}: FleetStatsBarProps) {
  const t = useNativeTranslationFallback();
  const totalDistance = analytics?.total_distance_km ?? 0;
  const totalEnergy = analytics?.total_energy_kwh ?? 0;

  return (
    <StaggerContainer style={styles.grid}>
      <StaggerItem style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.metricLabel}>
            {t('fleet.size', 'Fleet Size')}
          </AppText>
          <AnimatedNumber value={vehicleCount} style={styles.valuePrimary} />
          <AppText style={styles.subLabel}>
            {onlineCount} {t('fleet.online', 'online')}
          </AppText>
        </GlassPanel>
      </StaggerItem>

      <StaggerItem style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.metricLabel}>
            {t('fleet.distance', 'Distance (30d)')}
          </AppText>
          <AnimatedNumber
            value={toDistanceDisplay(totalDistance)}
            suffix={` ${distanceUnit}`}
            style={styles.valueCyan}
          />
          <MiniChart
            color="#00f0ff"
            data={recentDrives?.map(d => d.distance_m).reverse() ?? [0]}
            height={24}
            width={60}
          />
        </GlassPanel>
      </StaggerItem>

      <StaggerItem style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.metricLabel}>
            {t('fleet.energy', 'Energy (30d)')}
          </AppText>
          <AnimatedNumber
            decimals={1}
            suffix=" kWh"
            value={totalEnergy}
            style={styles.valueEmerald}
          />
          <MiniChart
            color="#10b981"
            data={
              recentCharges?.map(s => s.total_energy_added_wh).reverse() ?? [0]
            }
            height={24}
            width={60}
          />
        </GlassPanel>
      </StaggerItem>

      <StaggerItem style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.metricLabel}>
            {t('fleet.efficiency', 'Efficiency')}
          </AppText>
          <AnimatedNumber
            value={toEfficiencyDisplay(analytics?.avg_efficiency_wh_km ?? 0)}
            suffix={` ${efficiencyUnit}`}
            style={styles.valueAmber}
          />
          <AppText style={styles.subLabel}>
            {t('fleet.average', 'fleet average')}
          </AppText>
        </GlassPanel>
      </StaggerItem>

      <StaggerItem style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.metricLabel}>
            {t('fleet.alerts', 'Alerts')}
          </AppText>
          <AnimatedNumber
            value={unreadAlerts}
            style={[
              styles.valueBase,
              unreadAlerts > 0 ? styles.valueDanger : styles.valueSuccess,
            ]}
          />
          <AppText style={styles.subLabel}>
            {t('fleet.unread', 'unread')}
          </AppText>
        </GlassPanel>
      </StaggerItem>
    </StaggerContainer>
  );
}

FleetStatsBar.displayName = 'FleetStatsBar';

// text-cyan-300 / text-emerald-300 / text-amber-300 / text-red-500 / text-emerald-500
const CYAN_300 = '#67e8f9';
const EMERALD_300 = '#6ee7b7';
const AMBER_300 = '#fcd34d';
const RED_500 = '#ef4444';
const EMERALD_500 = '#10b981';

const styles = StyleSheet.create({
  animatedNumber: {
    fontVariant: ['tabular-nums'],
  },
  grid: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  gridItem: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  panel: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 92,
    padding: spacing.md,
  },
  subLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: spacing.xs,
  },
  valueAmber: {
    color: AMBER_300,
    fontSize: 22,
  },
  valueBase: {
    fontSize: 22,
  },
  valueCyan: {
    color: CYAN_300,
    fontSize: 22,
  },
  valueDanger: {
    color: RED_500,
  },
  valueEmerald: {
    color: EMERALD_300,
    fontSize: 22,
  },
  valuePrimary: {
    color: colors.textPrimary,
    fontSize: 22,
  },
  valueSuccess: {
    color: EMERALD_500,
  },
});
