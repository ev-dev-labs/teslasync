// Native parity port of
// web/src/features/vehicles/components/BatteryComparison.tsx.
//
// The web source renders a "Fleet Battery Status" GlassPanel: a lucide `Activity`
// heading icon + title, then one horizontal battery bar per vehicle whose state
// resolved (display name/VIN label, a level-driven gradient fill, the SoC %, and
// the formatted rated range). It batches `fetchVehicleState` calls through a
// single TanStack `useQuery` (key `['fleet-battery-states', sorted ids]`, enabled
// only when vehicles exist, 30s refetch), filters out vehicles whose state failed
// to load, and returns `null` when none remain.
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, or web UI):
//   * `useQuery` / `fetchVehicleState` are native-safe and reused verbatim (the
//     native `fetchVehicleState` already lives in web-parity/api/hooks). Its
//     result `state` is typed `VehicleState | string | null`, so the web's
//     `data?.state ?? null` becomes an object guard (`typeof === 'object'`) that
//     yields the same `VehicleState | null` the web produced.
//   * `useTranslation('vehicles')` -> a self-contained English-fallback `t`,
//     preserving the `fleet.batteryStatus` key + fallback.
//   * `useUnits().formatDistance` -> `useNativeUnits().formatDistance`, an exact
//     mirror of the web hook: it reads `useSettings()`, derives km/mi from
//     `unit_of_length`, the locale, and the decimal precision (floored, >=0, else
//     the distance default of 1), converts SI meters with the NIST factors, and
//     formats via `toLocaleString` -- returning '—' for non-finite input.
//   * `batteryColor` (@/lib/colors) -> an inline value-identical function with the
//     same >60 / >25 thresholds and the exact GOOD/WARN/BAD hex codes.
//   * lucide `Activity` (text-cyan-400) -> the repo SemanticIcon 'activity' ('AC')
//     glyph tinted cyan-400 (#22d3ee); the native app ships no lucide/SVG renderer.
//   * The DOM div/span bars + Tailwind become RN View/AppText; the CSS
//     `linear-gradient(90deg, ${color}80, ${color})` fill collapses to a solid
//     `color` (no RN gradient primitive is vendored, mirroring MetricBar), the
//     `0 0 10px ${color}40` glow maps to a colour-tinted native shadow (clipped by
//     the track's overflow-hidden exactly as the web box-shadow is), and the
//     `transition-all duration-slow` (400ms) width tween is reproduced with an
//     `Animated` width honouring reduce-motion.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {fetchVehicleState} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import type {Vehicle, VehicleState} from '../../../api/types';

// text-cyan-400 -- the heading Activity glyph tint (standard Tailwind cyan-400).
const CYAN_400 = '#22d3ee';

// NIST conversion factors mirrored from web @/lib/unitConversion.
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

// Distance default precision when `settings.decimal_precision` is unset, matching
// the web `DEFAULT_PRECISION.distance`.
const DEFAULT_DISTANCE_PRECISION = 1;

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next swap: the native app has no i18n runtime wired, so this returns
// the English fallback while preserving the i18n key intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Value-identical inline of web @/lib/colors `batteryColor(level)`.
function batteryColor(level: number): string {
  if (level > 60) {
    return '#10b981'; // COLOR.GOOD
  }
  if (level > 25) {
    return '#f59e0b'; // COLOR.WARN
  }
  return '#ef4444'; // COLOR.BAD
}

// Mirror of web `useUnits().derivePrecision`: a floored, non-negative integer or
// undefined (which makes the formatter fall back to the per-quantity default).
function derivePrecision(decimalPrecision: number | undefined): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision) || decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

function formatNumber(value: number, locale: string, digits: number): string {
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  };
  try {
    return value.toLocaleString(locale, opts);
  } catch {
    return value.toLocaleString('en-US', opts);
  }
}

// Native mirror of `useUnits().formatDistance`: derives the user's distance unit,
// locale, and precision from `useSettings()` and formats an SI-meters value the
// same way the web lib `formatDistance(meters, pref)` does (NIST factors,
// `toLocaleString`, '—' for non-finite input).
function useNativeUnits(): {
  formatDistance: (value: number | null | undefined) => string;
} {
  const {data: settings} = useSettings();
  return useMemo(() => {
    const distance: 'km' | 'mi' =
      settings?.unit_of_length === 'mi' ? 'mi' : 'km';
    const locale =
      typeof settings?.locale === 'string' && settings.locale.trim().length > 0
        ? settings.locale
        : 'en-US';
    const precision = derivePrecision(settings?.decimal_precision);

    const formatDistance = (value: number | null | undefined): string => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '—';
      }
      const digits = precision ?? DEFAULT_DISTANCE_PRECISION;
      const converted =
        distance === 'mi' ? value / METERS_PER_MILE : value / METERS_PER_KM;
      return `${formatNumber(converted, locale, digits)} ${distance}`;
    };

    return {formatDistance};
  }, [settings]);
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// The single battery bar. Reproduces `flex-1 h-3 rounded-full bg-white/[0.04]
// overflow-hidden` (track) wrapping the gradient/glow fill, with the web
// `transition-all duration-slow` width tween expressed via Animated (reduce-motion
// users get the final width instantly, matching the 0ms reduced-motion override).
function BatteryBar({level, color}: {level: number; color: string}) {
  const reduceMotion = useReduceMotion();
  const pct = Number.isFinite(level) ? Math.max(0, Math.min(level, 100)) : 0;
  const progress = useRef(new Animated.Value(pct)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(pct);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: pct,
      duration: 400,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: false,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [pct, progress, reduceMotion]);

  const width = progress.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.track}>
      <Animated.View
        style={[
          styles.fill,
          {width, backgroundColor: color, shadowColor: color},
        ]}
      />
    </View>
  );
}

type BatteryStateEntry = {vehicle: Vehicle; state: VehicleState | null};

interface BatteryComparisonProps {
  vehicles: Vehicle[];
}

export function BatteryComparison({vehicles}: BatteryComparisonProps) {
  const t = useNativeTranslationFallback();
  const {formatDistance} = useNativeUnits();
  const activityGlyph = getSemanticIconDefinition('activity').glyph;

  const {data: allStates} = useQuery({
    queryKey: ['fleet-battery-states', vehicles.map(v => v.id).sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        vehicles.map(async (v): Promise<BatteryStateEntry> => {
          try {
            const data = await fetchVehicleState(v.id);
            const candidate = data?.state;
            const state =
              candidate != null && typeof candidate === 'object'
                ? candidate
                : null;
            return {vehicle: v, state};
          } catch {
            return {vehicle: v, state: null};
          }
        }),
      );
      return entries;
    },
    enabled: vehicles.length > 0,
    refetchInterval: 30_000,
  });

  const bars = (allStates ?? []).filter(
    (q): q is {vehicle: Vehicle; state: VehicleState} => q.state !== null,
  );

  if (bars.length === 0) {
    return null;
  }

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.titleIcon} weight="bold">
          {activityGlyph}
        </AppText>
        <AppText style={styles.title} weight="semibold">
          {t('fleet.batteryStatus', 'Fleet Battery Status')}
        </AppText>
      </View>
      <View style={styles.bars}>
        {bars.map(({vehicle, state}) => {
          const level = state.battery_level ?? 0;
          const color = batteryColor(level);
          return (
            <View key={vehicle.id} style={styles.row}>
              <AppText style={styles.name} tone="secondary" numberOfLines={1}>
                {vehicle.display_name || vehicle.vin}
              </AppText>
              <BatteryBar level={level} color={color} />
              <AppText style={styles.levelValue}>{level}%</AppText>
              <AppText style={styles.range} tone="muted">
                {formatDistance(state.rated_range ?? 0)}
              </AppText>
            </View>
          );
        })}
      </View>
    </GlassPanel>
  );
}

BatteryComparison.displayName = 'BatteryComparison';

const styles = StyleSheet.create({
  // GlassPanel p-5.
  panel: {
    padding: 20,
  },
  // text-sm font-semibold ... mb-4 flex items-center gap-2.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  // Activity h-4 w-4 text-cyan-400.
  titleIcon: {
    color: CYAN_400,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  // text-sm font-semibold text-gray-900 dark:text-white (primary tone).
  title: {
    fontSize: 14,
    lineHeight: 20,
  },
  // space-y-3.
  bars: {
    gap: 12,
  },
  // flex items-center gap-3.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // text-xs text-[var(--text-secondary)] w-24 truncate.
  name: {
    width: 96,
    fontSize: 12,
    lineHeight: 16,
  },
  // flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden.
  track: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    overflow: 'hidden',
  },
  // h-full rounded-full + the collapsed gradient fill and 0 0 10px glow.
  fill: {
    height: '100%',
    borderRadius: 999,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  // text-xs font-medium text-gray-900 dark:text-white w-10 text-right.
  levelValue: {
    width: 40,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    textAlign: 'right',
  },
  // text-[10px] text-[var(--text-muted)] w-16 text-right.
  range: {
    width: 64,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'right',
  },
});
