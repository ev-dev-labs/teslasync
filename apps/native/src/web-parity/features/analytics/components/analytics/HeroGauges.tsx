// Native parity port of
// web/src/features/analytics/components/analytics/HeroGauges.tsx.
//
// The web HeroGauges renders the fleet-analytics "hero" strip: a responsive
// grid (2-up on phones, up to 6-up on desktop) of MetricCard tiles for
// Distance, Drives, Energy, Efficiency, Gas Savings, and CO₂ Saved, with a
// 6-tile skeleton grid while `data` is undefined. It is reproduced here with
// React Native primitives and the native parity component library while
// preserving every state name, API field, unit-handling rule, derived heuristic
// (gas-savings / CO₂ / efficiency), and i18n key:
//
//   - web `react-i18next` useTranslation -> local t(key, fallback) shim (the
//     source passes the English copy as the fallback, so every key is preserved
//     verbatim as the visible string).
//   - web `lucide-react` MapPin/Car/Zap/Gauge/DollarSign/Leaf -> no native icon
//     dependency; rendered as short colour-coded MetricCard badge glyphs
//     (MapPin->PN, Car->CR, Zap->ZP, Gauge->GA, DollarSign->$, Leaf->LF),
//     keeping the web per-card `color` intent.
//   - web `@/components/data-display` MetricCard is NOT yet ported to native
//     parity (separate conversion target), so a self-contained native MetricCard
//     equivalent is inlined here with the same label/value/subtitle/icon/color
//     contract, following the BatteryTab inlining precedent. The web `color`
//     NeonColor (cyan/purple/green/amber) drives the badge tint via a local
//     token map.
//   - web `@/components/charts` `safe` -> inlined native-safe `safe` (finite or 0).
//   - web `@/hooks/useUnits` -> native useUnits() shim: the native parity layer
//     has no settings store wired in, so it mirrors the web out-of-box defaults
//     (distance 'km') and reads SI straight from the API, converting at the
//     display boundary exactly as the web hook does.
//   - web `@/hooks/useFormatting` formatCurrency -> native useFormatting() shim
//     mirroring the web out-of-box defaults (currency symbol '$', precision 2).
//   - web `@/lib/unitConversion` convertDistanceFromSI -> inlined native
//     convertDistanceFromSI (SI meters -> display unit; km/mi/ft).
//   - web `@/lib/numberFormat` fmtNumber/fmtInt -> inlined native-safe formatters.
//   - web `import type { FleetAnalytics } from '@/api/types'` -> native parity
//     type (identical total_distance_km/total_drives/total_energy_kwh/
//     total_cost/avg_efficiency_wh_km shape).
//   - web `./helpers` MetricSkeleton (GlassPanel + two Skeleton bars) -> inlined
//     native MetricSkeleton with a reduced-motion-aware pulse block, preserving
//     the original width/height intent.

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
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {FleetAnalytics} from '../../../../api/types';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ─── native-safe helpers (web `@/components/charts` + `@/lib/numberFormat`) ── */

const DEFAULT_GLOBAL_PRECISION = 2;

// Mirrors web `safe` from `@/components/charts` (chartUtils): finite or 0.
function safe(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safe(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safe(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ───── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

// Mirrors web `convertDistanceFromSI` (SI meters -> display unit).
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
    case 'km':
    default:
      return meters / METERS_PER_KM;
  }
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
}

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box default: distance 'km'. The API already returns SI;
// conversion happens at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(() => ({unitPrefs: {distance: 'km'}}), []);
}

/* ─── native formatting shim (web `@/hooks/useFormatting`) ─────────────────── */

const DEFAULT_CURRENCY_SYMBOL = '$';

interface UseFormattingResult {
  formatCurrency: (amount: number, decimals?: number) => string;
}

// Mirrors the web out-of-box defaults: currency symbol '$', precision 2.
function useFormatting(): UseFormattingResult {
  return useMemo<UseFormattingResult>(
    () => ({
      formatCurrency: (amount, decimals) =>
        `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(
          amount,
          decimals ?? DEFAULT_GLOBAL_PRECISION,
        )}`,
    }),
    [],
  );
}

/* ─── MetricCard (web `@/components/data-display` MetricCard, not yet ported) ─ */

type MetricColor = 'cyan' | 'green' | 'amber' | 'purple';

interface MetricTint {
  surface: string;
  border: string;
  glyph: string;
}

const METRIC_TINTS: Record<MetricColor, MetricTint> = {
  cyan: {
    surface: colors.accentSoft,
    border: colors.borderAccent,
    glyph: colors.accent,
  },
  green: {
    surface: colors.successSurface,
    border: colors.successBorder,
    glyph: colors.success,
  },
  amber: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    glyph: colors.warning,
  },
  purple: {
    surface: colors.violetSurface,
    border: colors.violetBorder,
    glyph: colors.violet,
  },
};

interface MetricCardProps {
  label: string;
  value: string;
  iconGlyph: string;
  color: MetricColor;
  subtitle?: string;
}

function MetricCard({label, value, iconGlyph, color, subtitle}: MetricCardProps) {
  const tint = METRIC_TINTS[color] ?? METRIC_TINTS.cyan;
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricBody}>
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
          {value}
        </AppText>
        {subtitle ? (
          <AppText
            numberOfLines={1}
            style={styles.metricSubtitle}
            tone="muted"
            variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View
        style={[
          styles.metricBadge,
          {backgroundColor: tint.surface, borderColor: tint.border},
        ]}>
        <AppText style={[styles.metricBadgeGlyph, {color: tint.glyph}]} weight="bold">
          {iconGlyph}
        </AppText>
      </View>
    </View>
  );
}

MetricCard.displayName = 'MetricCard';

/* ─── MetricSkeleton (web `./helpers` MetricSkeleton, not yet ported) ──────── */

const SKELETON_COLOR = 'rgba(148, 163, 184, 0.18)';

function Skeleton({
  width,
  height,
  style,
}: {
  width: DimensionValue;
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const pulse = useLoopingPulse(reduceMotion);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.45, 0.85],
        }),
      };

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.skeleton, {height, width}, animatedStyle, style]}
    />
  );
}

function MetricSkeleton() {
  return (
    <GlassPanel style={styles.skeletonCard}>
      <Skeleton height={12} width="60%" />
      <Skeleton height={24} style={styles.skeletonSpacing} width="40%" />
    </GlassPanel>
  );
}

MetricSkeleton.displayName = 'MetricSkeleton';

/* ─── reduced-motion-aware pulse (web `animate-pulse`) ─────────────────────── */

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

function useLoopingPulse(reduceMotion: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;

  const reset = useCallback(() => pulse.setValue(0), [pulse]);

  useEffect(() => {
    if (reduceMotion) {
      reset();
      return;
    }

    reset();
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion, reset]);

  return pulse;
}

/* ─── HeroGauges ───────────────────────────────────────────────────────────── */

const KM_PER_MILE = 1.609344;

export function HeroGauges({data}: {data: FleetAnalytics | undefined}) {
  const t = useNativeTranslationFallback();
  const {unitPrefs} = useUnits();
  const {formatCurrency} = useFormatting();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  if (!data) {
    return (
      <View style={styles.grid}>
        {Array.from({length: 6}).map((_, i) => (
          <MetricSkeleton key={i} />
        ))}
      </View>
    );
  }

  // backend `total_distance_km` is SI km — go through the meter-floored helper
  // so the conversion factor lives in `lib/unitConversion`, not here.
  const totalDistKm = data.total_distance_km ?? 0;
  const totalDist = convertDistanceFromSI(totalDistKm * 1000, distanceUnit);
  // Gas savings + CO₂ heuristics are tied to KM regardless of display unit so
  // the dollar/kg outputs stay stable for the same trip.
  const gasSavings = totalDistKm * 0.085 * 1.5 - safe(data.total_cost);
  const co2Saved = totalDistKm * 0.12;
  const avgEffWhPerKm = data.avg_efficiency_wh_km ?? 0;
  const avgEffDisplay =
    distanceUnit === 'mi' ? avgEffWhPerKm * KM_PER_MILE : avgEffWhPerKm;

  return (
    <View style={styles.grid}>
      <MetricCard
        color="cyan"
        iconGlyph="PN"
        label={t('analytics.hero.distance', 'Distance')}
        subtitle={distanceUnit}
        value={fmtNumber(totalDist, 1)}
      />
      <MetricCard
        color="purple"
        iconGlyph="CR"
        label={t('analytics.hero.drives', 'Drives')}
        value={fmtInt(data.total_drives)}
      />
      <MetricCard
        color="green"
        iconGlyph="ZP"
        label={t('analytics.hero.energy', 'Energy')}
        subtitle="kWh"
        value={fmtNumber(data.total_energy_kwh, 1)}
      />
      <MetricCard
        color="amber"
        iconGlyph="GA"
        label={t('analytics.hero.efficiency', 'Efficiency')}
        subtitle={efficiencyUnit}
        value={fmtNumber(avgEffDisplay, 1)}
      />
      <MetricCard
        color="green"
        iconGlyph="$"
        label={t('analytics.hero.gasSavings', 'Gas Savings')}
        value={formatCurrency(Math.max(gasSavings, 0), 0)}
      />
      <MetricCard
        color="green"
        iconGlyph="LF"
        label={t('analytics.hero.co2Saved', 'CO₂ Saved')}
        subtitle="kg"
        value={fmtNumber(co2Saved, 0)}
      />
    </View>
  );
}

HeroGauges.displayName = 'HeroGauges';

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricBadge: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  metricBadgeGlyph: {
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  metricBody: {
    flexShrink: 1,
    minWidth: 0,
  },
  metricCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  metricLabel: {
    letterSpacing: 0.6,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  metricSubtitle: {
    marginTop: 2,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  skeleton: {
    backgroundColor: SKELETON_COLOR,
    borderRadius: 6,
  },
  skeletonCard: {
    borderRadius: 14,
    flexBasis: '47%',
    flexGrow: 1,
    padding: spacing.md,
  },
  skeletonSpacing: {
    marginTop: spacing.sm,
  },
});
