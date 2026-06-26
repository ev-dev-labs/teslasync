// Native parity port of web/src/features/vehicles/components/FleetSummary.tsx.
//
// The web component is the Vehicles "Fleet Summary" strip: a responsive Tailwind
// grid (2 cols base → 4 cols at sm) of four GlassPanel stat tiles —
//   1. Vehicles          — vehicles.length (Car icon, cyan-400).
//   2. Avg Battery        — Math.round(avgBattery) + "%" (Battery icon, green-500),
//                           the mean of every state.battery_level (?? 0).
//   3. Total Range        — Math.round(convertDistanceFromSI(totalRangeMeters,
//                           unitPrefs.distance)) with the unit appended to the
//                           label (Gauge icon, purple-400); the range is summed in
//                           SI metres (state.rated_range) and converted at display.
//   4. Charging / Online  — chargingCount "/ onlineCount" (Zap icon, amber-400);
//                           chargingCount is green-500, the "/ N" suffix is muted.
// Each numeric value uses <AnimatedNumber> (an ease-out count-up). Per-vehicle
// states are loaded with a single useQuery that fans out fetchVehicleState over
// every vehicle (keyed by the sorted vehicle ids, enabled when there is ≥ 1
// vehicle, refetched every 30 s) and null-collapses failures.
//
// This native port preserves that contract 1:1 — the same `vehicles` prop, the
// same useQuery key (['fleet-vehicle-states', sorted ids]) / queryFn fan-out /
// enabled / refetchInterval, the same null filtering, the same avgBattery /
// totalRangeMeters (SI metres) / chargingCount / onlineCount derivations with
// `?? 0` null-safety, the same convert-at-display unit handling, the same four
// tiles, every i18n key + English default, and the same visual intent — using
// React Native primitives, the existing native GlassPanel + AppText + design
// tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - @tanstack/react-query useQuery (web L1): kept verbatim — react-query runs
//     natively (same key/queryFn/enabled/refetchInterval contract).
//   - lucide-react Car / Battery / Gauge / Zap (web L2): DOM SVG icons → semantic
//     emoji glyph stand-ins (🚗 / 🔋 / 🧭 / ⚡), tinted with the web tile colours
//     (cyan-400 / green-500 / purple-400 / amber-400).
//   - react-i18next useTranslation('vehicles') (web L3): no native i18next runtime
//     → inline useNativeTranslation() returns t(key, fallback?) = fallback ?? key,
//     preserving every key + English default (the namespace is display-inert).
//   - @/components/ui/GlassPanel (web L4): GlassPanel → native GlassPanel.
//   - @/components/data-display/AnimatedNumber (web L5): the web span uses
//     requestAnimationFrame + ease-out; reproduced here as an inline native-safe
//     <AnimatedNumber> driving an AppText (RAF + Date.now, same ease-out quad,
//     same value/duration/decimals/prefix/suffix props, tabular-nums →
//     fontVariant). Cleans up its frame on unmount.
//   - @/hooks/useUnits useUnits (web L6): not yet ported → reproduced as a scoped
//     native useUnits() returning unitPrefs.distance derived from the same
//     web-parity useSettings().unit_of_length ('mi' → 'mi', else 'km').
//   - @/lib/unitConversion convertDistanceFromSI (web L7): inlined verbatim
//     (metres → km / mi) for the consumed 'km' | 'mi' union.
//   - @/api/hooks/useVehicles fetchVehicleState (web L8): the already-ported
//     web-parity fetchVehicleState (same `/vehicles/{id}/state` path). Its native
//     return type widens `.state` to VehicleState | string | null, so the queryFn
//     keeps only structured-object states — matching the web contract where
//     `.state` is always a VehicleState object (or absent).
//   - @/api/types Vehicle (web L9): imported from the already-ported native
//     web-parity api/types so the prop contract is identical.
//   - @/api/types VehicleState (web L10): imported from the native useVehicles
//     module (where the normalized live-state type lives alongside
//     fetchVehicleState) so the filtered state type matches the fetch return —
//     semantically identical to the web api/types VehicleState.
//   - the Tailwind responsive grid (grid-cols-2 sm:grid-cols-4, web L52) collapses
//     to the mobile-first 2-column flex wrap (the web base breakpoint).
//   - the web hover:scale-[1.02] transition (web L53/63/73/83) has no native hover
//     equivalent and is omitted.
//
// No DOM module, browser HTML element, Recharts, Leaflet, lucide DOM SVG,
// framer-motion, or old web @/components import appears in the native output.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, View, type StyleProp, type TextStyle} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {useSettings} from '../../../api/hooks/useSettings';
import {fetchVehicleState, type VehicleState} from '../../../api/hooks/useVehicles';
import type {Vehicle} from '../../../api/types';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ── native translation fallback (native-safe port of react-i18next) ──────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback ?? _key, []);
}

/* ── native-safe useUnits (web useUnits → useSettings derivation, inlined) ─── */

type DistanceUnitPref = 'km' | 'mi';

function useUnits(): {unitPrefs: {distance: DistanceUnitPref}} {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const unitPrefs = useMemo(
    () => ({distance: (unitOfLength === 'mi' ? 'mi' : 'km') as DistanceUnitPref}),
    [unitOfLength],
  );
  return {unitPrefs};
}

/* ── convertDistanceFromSI (ported from web/src/lib/unitConversion.ts) ─────── */

// Mirrors web/src/lib/unitConversion.ts so the imperial branch matches exactly.
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
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

/* ── lucide-react glyph stand-ins (web L2) ─────────────────────────────────── */

const GLYPH_CAR = '\uD83D\uDE97'; // 🚗 (Car)
const GLYPH_BATTERY = '\uD83D\uDD0B'; // 🔋 (Battery)
const GLYPH_GAUGE = '\uD83E\uDDED'; // 🧭 (Gauge)
const GLYPH_ZAP = '\u26A1'; // ⚡ (Zap)

/* ── ported: FleetSummary (web L12-95) ─────────────────────────────────────── */

interface FleetSummaryProps {
  vehicles: Vehicle[];
}

export function FleetSummary({vehicles}: FleetSummaryProps) {
  const t = useNativeTranslation();
  const {unitPrefs} = useUnits();

  const {data: allStates} = useQuery({
    queryKey: ['fleet-vehicle-states', vehicles.map(v => v.id).sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        vehicles.map(async v => {
          try {
            const data = await fetchVehicleState(v.id);
            const state = data?.state;
            // Native fetchVehicleState widens `.state` to a legacy scalar string;
            // the web contract is always a structured VehicleState object (or
            // absent), so keep only object states (else null) — matching web.
            return state != null && typeof state === 'object' ? state : null;
          } catch {
            return null;
          }
        }),
      );
      return entries;
    },
    enabled: vehicles.length > 0,
    refetchInterval: 30_000,
  });

  const states = (allStates ?? []).filter(
    (s): s is VehicleState => s !== null && s !== undefined,
  );
  const avgBattery =
    states.length > 0
      ? states.reduce((sum, st) => sum + (st.battery_level ?? 0), 0) / states.length
      : 0;
  // Sum is in SI metres (VehicleState.rated_range is metres). Convert at display.
  const totalRangeMeters = states.reduce((sum, st) => sum + (st.rated_range ?? 0), 0);
  const chargingCount = states.filter(st => st.is_charging).length;
  const onlineCount = states.length;

  return (
    <View style={styles.grid}>
      <View style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={[styles.icon, styles.iconCyan]}>{GLYPH_CAR}</AppText>
          <AnimatedNumber value={vehicles.length} style={styles.value} />
          <AppText style={styles.label}>
            {t('fleet.vehicles', 'Vehicles')}
          </AppText>
        </GlassPanel>
      </View>

      <View style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={[styles.icon, styles.iconGreen]}>
            {GLYPH_BATTERY}
          </AppText>
          <AnimatedNumber
            value={Math.round(avgBattery)}
            suffix="%"
            style={styles.value}
          />
          <AppText style={styles.label}>
            {t('fleet.avgBattery', 'Avg Battery')}
          </AppText>
        </GlassPanel>
      </View>

      <View style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={[styles.icon, styles.iconPurple]}>
            {GLYPH_GAUGE}
          </AppText>
          <AnimatedNumber
            value={Math.round(
              convertDistanceFromSI(totalRangeMeters, unitPrefs.distance),
            )}
            style={styles.value}
          />
          <AppText style={styles.label}>
            {t('fleet.totalRange', 'Total Range')} {unitPrefs.distance}
          </AppText>
        </GlassPanel>
      </View>

      <View style={styles.gridItem}>
        <GlassPanel style={styles.panel}>
          <AppText style={[styles.icon, styles.iconAmber]}>{GLYPH_ZAP}</AppText>
          <View style={styles.chargingRow}>
            <AnimatedNumber
              value={chargingCount}
              style={[styles.value, styles.valueGreen]}
            />
            <AppText style={styles.chargingSub}>{` / ${onlineCount}`}</AppText>
          </View>
          <AppText style={styles.label}>
            {t('fleet.chargingOnline', 'Charging / Online')}
          </AppText>
        </GlassPanel>
      </View>
    </View>
  );
}

FleetSummary.displayName = 'FleetSummary';

// Tile icon tints mirror the web lucide classes.
const CYAN_400 = '#22d3ee'; // text-cyan-400
const GREEN_500 = '#22c55e'; // text-green-500
const PURPLE_400 = '#c084fc'; // text-purple-400
const AMBER_400 = '#fbbf24'; // text-amber-400

const styles = StyleSheet.create({
  animatedNumber: {
    fontVariant: ['tabular-nums'],
  },
  chargingRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
  },
  chargingSub: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
  },
  grid: {
    columnGap: 16, // gap-4
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 16, // gap-4
  },
  gridItem: {
    flexBasis: '47%', // grid-cols-2 base breakpoint
    flexGrow: 1,
  },
  icon: {
    fontSize: 20, // h-5 w-5
    marginBottom: spacing.sm, // mb-2
  },
  iconAmber: {
    color: AMBER_400,
  },
  iconCyan: {
    color: CYAN_400,
  },
  iconGreen: {
    color: GREEN_500,
  },
  iconPurple: {
    color: PURPLE_400,
  },
  label: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    letterSpacing: 0.6, // tracking-wider
    marginTop: spacing.xs,
    textTransform: 'uppercase',
  },
  panel: {
    alignItems: 'center', // text-center
    padding: 16, // p-4
  },
  value: {
    color: colors.textPrimary, // text-gray-900 dark:text-white
    fontSize: 24, // text-2xl
  },
  valueGreen: {
    color: GREEN_500, // text-green-500
  },
});
