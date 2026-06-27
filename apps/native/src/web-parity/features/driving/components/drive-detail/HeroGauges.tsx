// Native parity port of
// web/src/features/driving/components/drive-detail/HeroGauges.tsx.
//
// `HeroGauges` is the hero band of the single-drive deep dive (DriveDetailPage):
// a centered, wrapping row of up to five RadialGauges inside a GlassPanel —
// Distance (#00f0ff), Max Speed (#a855f7), Duration (#f59e0b), Consumption
// (#ef4444) and, only when `stats.efficiencyPctPer100 != null`, Efficiency
// (#10b981). Every gauge value/max formula, the SI->display conversions
// (distanceM via convertDistanceFromSI, the toSpeedDisplay(250) speed-axis cap,
// durationS/60 minutes, the Wh/km->Wh/mi efficiency multiply 1.609344), every
// i18n key + English fallback, the `size={110}`, the colour hexes, and the
// `unit` labels (distanceUnit / speedUnit / 'min' / efficiencyUnit and the
// isMiles-gated '%/100mi' | '%/100km') are preserved verbatim.
//
// Web module -> native-safe mappings (contract rules 4-7):
//   - `@/components/ui` GlassPanel (L2) -> the shared native components/ui
//     GlassPanel; the web `className="p-6 relative overflow-hidden"` moves to the
//     forwarded `style` (padding 24 == p-6 / position relative / overflow hidden).
//   - `@/components/charts` RadialGauge (L3) -> the web-parity components/charts
//     RadialGauge (a real native port: an arc approximated with positioned Views
//     plus a centered value/unit overlay). Same prop surface
//     (value/max/label/unit/color/size).
//   - `@/components/motion` FadeIn (L4) -> the ported web-parity components/motion
//     FadeIn (no delay, matching the source).
//   - `@/hooks/useSettings` (L5) -> the ported web-parity hooks/useSettings
//     (returns `{ isMiles, settings, ... }`); only `isMiles` is read directly
//     (the efficiency `unit` label at L71).
//   - `@/hooks/useUnits` (L6) -> a local shim deriving `unitPrefs.distance`
//     ('mi'/'km') and `unitPrefs.speed` ('mph'/'km/h') from the same
//     useSettings `unit_of_length`, mirroring the web hook (which itself reads
//     useSettings). Only these two prefs are read here. The component's direct
//     useSettings read (isMiles) + the shim's useSettings read mirror the web's
//     two settings reads 1:1; TanStack Query dedupes them.
//   - `@/lib/numberFormat` fmtNumber (L7) -> an inlined native-safe equivalent
//     (+ its safeNumber dep): nullish/non-finite -> 0, en-US locale, default
//     precision 2. Used at L68 (Number(fmtNumber(efficiencyPctPer100))).
//   - `@/types/driving` DriveDetail (L8) -> imported from the native
//     api/hooks/useDriving port (matches the web shape field-for-field; only
//     `distanceM` + `durationS` are read).
//   - `./types` DriveStats (L9) -> inlined verbatim (the drive-detail types.ts is
//     not a standalone native port yet; only `maxSpd`, `consumptionWhKm` and
//     `efficiencyPctPer100` are read). Mirrors the CostSavingsPanel /
//     DriveDetailPage local DriveStats.
//   - `@/lib/unitConversion` convertDistanceFromSI + convertSpeedFromSI (L10) ->
//     inlined native-safe SI converters narrowed to the 'km'/'mi' + 'km/h'/'mph'
//     prefs this file emits (the web 'ft' distance branch is unreachable from
//     `unitPrefs.distance`). Constants match the lib (1000 m/km, 1609.344 m/mi,
//     3600 s/h).
//   - react-i18next `useTranslation` (L1) -> the standard local key-preserving
//     fallback shim (every call here is the simple `t(key, 'English')` shape;
//     react-i18next is absent from the native deps).
//
// DOM -> native element mapping: the GlassPanel's decorative
// `<div className="absolute inset-0 bg-gradient-to-r from-cyan-500/[0.02]
// to-purple-500/[0.02]" />` (L32) -> an absolutely-filled, a11y-hidden `View`
// with a flat ~2%-opacity cyan wash. React Native has no CSS linear-gradient
// (this app vendors no react-native-svg / expo-linear-gradient), so the
// horizontal cyan->purple gradient is APPROXIMATED by a flat near-transparent
// tint; the intent (a faint coloured wash behind the gauges) is preserved and
// the limitation is documented in the sidecar. The inner
// `<div className="relative flex flex-wrap items-center gap-6 lg:gap-10
// justify-center">` (L33) -> a `View` row (flexDirection row / flexWrap wrap /
// alignItems center / justifyContent center / gap 24 for the `gap-6` base; native
// has no `lg:` breakpoint so the `lg:gap-10` step is not reproduced). No DOM-only
// modules, browser HTML elements, Recharts, Leaflet, or old web UI components are
// imported into this native output.

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { RadialGauge } from '../../../../components/charts';
import { FadeIn } from '../../../../components/motion';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { useSettings } from '../../../../hooks/useSettings';
import type { DriveDetail } from '../../../../api/hooks/useDriving';

// ─── i18n fallback (react-i18next) ────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): { t: TFunc } {
  return { t: (_key, fallback) => fallback };
}

// ─── numberFormat (inlined from @/lib/numberFormat) ───────────
// safeNumber collapses nullish/non-finite to 0; fmtNumber is the locale-aware
// fixed-precision formatter (default precision 2, en-US), mirroring the web lib.
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toFixed(d);
  }
}

// ─── unitConversion SI converters (inlined from @/lib/unitConversion) ──
// Narrowed to the prefs this file emits: distance 'km'/'mi', speed 'km/h'/'mph'
// (the web 'ft' distance branch is unreachable from `unitPrefs.distance`).
type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const SECONDS_PER_HOUR = 3600;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

// ─── useUnits shim (@/hooks/useUnits) ─────────────────────────
// Derives the distance + speed prefs from `unit_of_length`, mirroring the web
// hook (which itself reads useSettings). Only `unitPrefs.distance` and
// `unitPrefs.speed` are read by this component.
function useUnits(): {
  unitPrefs: { distance: DistanceUnitPref; speed: SpeedUnitPref };
} {
  const { settings } = useSettings();
  const isMi = settings.unit_of_length === 'mi';
  const distance: DistanceUnitPref = isMi ? 'mi' : 'km';
  const speed: SpeedUnitPref = isMi ? 'mph' : 'km/h';
  return useMemo(() => ({ unitPrefs: { distance, speed } }), [distance, speed]);
}

// ─── DriveStats (inlined from ./types) ────────────────────────
// The drive-detail types.ts is not a standalone native port yet; the consumed
// shape is inlined verbatim (only `maxSpd`, `consumptionWhKm` and
// `efficiencyPctPer100` are read). Mirrors the CostSavingsPanel /
// DriveDetailPage local DriveStats field-for-field.
interface DriveStats {
  maxSpd: number;
  avgSpd: number;
  minSpd: number;
  powerMax: number;
  powerMin: number;
  avgPower: number;
  energyWh: number;
  regenWh: number;
  consumptionWhKm: number;
  elevGain: number;
  elevLoss: number;
  avgOutsideTemp: number | null;
  avgInsideTemp: number | null;
  hasAnyTemp: boolean;
  insideTemps: number[];
  outsideTemps: number[];
  driverTemps: number[];
  passengerTemps: number[];
  climateStatus: string | null;
  avgFanSpeed: number | null;
  maxFanSpeed: number | null;
  startRange: number | null;
  endRange: number | null;
  odometerStart: number;
  odometerEnd: number;
  hasTirePressure: boolean;
  efficiencyPctPer100: number | null;
}

interface HeroGaugesProps {
  drive: DriveDetail;
  stats: DriveStats;
}

export function HeroGauges({ drive, stats }: HeroGaugesProps) {
  const { t } = useTranslation();
  const { isMiles } = useSettings();
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toSpeedDisplay = (value: number) =>
    convertSpeedFromSI(value, unitPrefs.speed);
  const toEfficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.gradientOverlay}
        />
        <View style={styles.gaugeRow}>
          <RadialGauge
            value={Math.round(toDistanceDisplay(drive.distanceM))}
            max={Math.max(toDistanceDisplay(drive.distanceM) * 1.5, 100)}
            label={t('driveDetail.distance', 'Distance')}
            unit={distanceUnit}
            color="#00f0ff"
            size={110}
          />
          <RadialGauge
            value={Math.round(stats.maxSpd)}
            max={toSpeedDisplay(250)}
            label={t('driveDetail.maxSpeed', 'Max Speed')}
            unit={speedUnit}
            color="#a855f7"
            size={110}
          />
          <RadialGauge
            value={Math.round((drive.durationS ?? 0) / 60)}
            max={Math.max(((drive.durationS ?? 0) / 60) * 1.5, 60)}
            label={t('driveDetail.duration', 'Duration')}
            unit="min"
            color="#f59e0b"
            size={110}
          />
          <RadialGauge
            value={Math.round(toEfficiencyDisplay(stats.consumptionWhKm))}
            max={Math.max(toEfficiencyDisplay(stats.consumptionWhKm) * 1.5, 300)}
            label={t('driveDetail.consumption', 'Consumption')}
            unit={efficiencyUnit}
            color="#ef4444"
            size={110}
          />
          {stats.efficiencyPctPer100 != null && (
            <RadialGauge
              value={Number(fmtNumber(stats.efficiencyPctPer100))}
              max={30}
              label={t('driveDetail.efficiency', 'Efficiency')}
              unit={isMiles ? '%/100mi' : '%/100km'}
              color="#10b981"
              size={110}
            />
          )}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  gaugeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    justifyContent: 'center',
  },
  gradientOverlay: {
    backgroundColor: 'rgba(53, 213, 255, 0.02)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  panel: {
    overflow: 'hidden',
    padding: 24,
    position: 'relative',
  },
});
