// Native parity port of
// web/src/features/analytics/components/analytics/DrivingPerformanceCards.tsx.
//
// The web component renders a responsive Tailwind grid (2 → 3 → 6 columns) of
// six <MetricCard>s summarising fleet drive performance: top/avg speed, peak
// power, peak regen, and average/longest drive distance. Speed and distance are
// converted from the backend's km/h and km figures (through an SI floor of m/s
// and meters) into the user's display unit; power and regen stay in kW as-is.
//
// Native reductions (documented in the parity sidecar):
//   - react-i18next `useTranslation` (web L1/L14): there is no native i18next
//     runtime, so a native-safe `t(key, fallback)` shim returns the English
//     fallback (else the key), preserving the i18n key + intent of each label.
//   - lucide-react icons (web L2): Gauge/TrendingUp/Zap/BatteryCharging/MapPin/
//     Car are DOM SVG components; native substitutes a semantic emoji glyph per
//     card, passed as MetricCard's string `icon` so it sits in the neon chip.
//   - `useUnits()` (web L5/L15-17): no native useUnits hook is ported yet, so an
//     inline native-safe hook derives the same {distance, speed} prefs from the
//     web-parity `useSettings()` query exactly as the web hook does.
//   - `convertDistanceFromSI`/`convertSpeedFromSI` (web L6) and `fmtNumber`
//     (web L7): ported verbatim from web/src/lib (SI-floor math, en-US locale).
//   - The Tailwind responsive grid (web L30) flattens to a 2-column wrapped
//     native grid (the primary mobile breakpoint); the md/lg column counts are
//     not applicable on a phone viewport.

import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import type {FleetAnalytics} from '../../../../api/types';
import {safe} from '../../../../components/charts';
import {MetricCard} from '../../../../components/data-display/MetricCard';
import {spacing} from '../../../../../theme/tokens';

// Web L10-11: backend speed_stats is km/h and distance_stats is km; the SI floor
// is m/s and meters, so these constants bridge km/h → m/s and km → m before the
// SI converters run.
const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
// Mirrors web/src/lib/unitConversion.ts so the imperial branch matches exactly.
const METERS_PER_MILE = 1609.344;

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';

// ── native-safe useTranslation (react-i18next has no native runtime) ─────────
type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

// ── native-safe useUnits (web useUnits → useSettings derivation, inlined) ─────
interface UnitPrefs {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const unitPrefs = useMemo<UnitPrefs>(
    () => ({
      distance: unitOfLength === 'mi' ? 'mi' : 'km',
      speed: unitOfLength === 'mi' ? 'mph' : 'km/h',
    }),
    [unitOfLength],
  );
  return {unitPrefs};
}

// ── SI-floor converters (ported from web/src/lib/unitConversion.ts) ──────────
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

// ── locale number formatter (ported from web/src/lib/numberFormat.ts) ────────
function fmtNumber(value: number, decimals: number): string {
  const n = Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

// Semantic emoji stand-ins for the lucide-react icons (web L2). Passed as the
// MetricCard string `icon` so each glyph inherits its neon chip.
const ICON_TOP_SPEED = '🏁'; // Gauge
const ICON_AVG_SPEED = '📈'; // TrendingUp
const ICON_PEAK_POWER = '⚡'; // Zap
const ICON_PEAK_REGEN = '🔋'; // BatteryCharging
const ICON_AVG_DISTANCE = '📍'; // MapPin
const ICON_LONGEST_DRIVE = '🚗'; // Car

const EMPTY_VALUE = '—';

export function DrivingPerformanceCards({
  data,
}: {
  data: FleetAnalytics | undefined;
}) {
  const t = useNativeTranslation();
  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  // backend `speed_stats` is km/h; SI floor is m/s.
  const fromKmh = (kmh: number) =>
    convertSpeedFromSI((kmh * METERS_PER_KM) / SECONDS_PER_HOUR, speedUnit);
  // backend `distance_stats` is km; SI floor is meters.
  const fromKm = (km: number) =>
    convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);

  const da = data?.drive_analytics;
  const ss = da?.speed_stats;
  const ps = da?.power_stats;
  const rs = da?.regen_stats;
  const ds = da?.distance_stats;

  return (
    <View style={styles.grid}>
      <View style={styles.cell}>
        <MetricCard
          color="cyan"
          icon={ICON_TOP_SPEED}
          label={t('analytics.driving.topSpeed', 'Top Speed')}
          subtitle={speedUnit}
          value={ss ? fmtNumber(fromKmh(safe(ss.max)), 0) : EMPTY_VALUE}
        />
      </View>
      <View style={styles.cell}>
        <MetricCard
          color="purple"
          icon={ICON_AVG_SPEED}
          label={t('analytics.driving.avgSpeed', 'Avg Speed')}
          subtitle={speedUnit}
          value={ss ? fmtNumber(fromKmh(safe(ss.avg)), 0) : EMPTY_VALUE}
        />
      </View>
      <View style={styles.cell}>
        <MetricCard
          color="amber"
          icon={ICON_PEAK_POWER}
          label={t('analytics.driving.peakPower', 'Peak Power')}
          subtitle="kW"
          value={ps ? fmtNumber(safe(ps.max), 0) : EMPTY_VALUE}
        />
      </View>
      <View style={styles.cell}>
        <MetricCard
          color="green"
          icon={ICON_PEAK_REGEN}
          label={t('analytics.driving.peakRegen', 'Peak Regen')}
          subtitle="kW"
          value={rs ? fmtNumber(safe(rs.max), 0) : EMPTY_VALUE}
        />
      </View>
      <View style={styles.cell}>
        <MetricCard
          color="cyan"
          icon={ICON_AVG_DISTANCE}
          label={t('analytics.driving.avgDriveDist', 'Avg Drive Distance')}
          subtitle={distanceUnit}
          value={ds ? fmtNumber(fromKm(safe(ds.avg)), 1) : EMPTY_VALUE}
        />
      </View>
      <View style={styles.cell}>
        <MetricCard
          color="purple"
          icon={ICON_LONGEST_DRIVE}
          label={t('analytics.driving.longestDrive', 'Longest Drive')}
          subtitle={distanceUnit}
          value={ds ? fmtNumber(fromKm(safe(ds.max)), 1) : EMPTY_VALUE}
        />
      </View>
    </View>
  );
}

DrivingPerformanceCards.displayName = 'DrivingPerformanceCards';

const styles = StyleSheet.create({
  cell: {
    width: '48%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
});
