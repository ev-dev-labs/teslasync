// Native parity port of
// web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx.
//
// Preserves the six summary tiles (Total Sessions, Total Energy, Avg Charge
// Rate, Peak Rate, Avg Duration, Total Cost), every i18n key + English
// fallback, the per-tile formatter choice (fmtInt vs fmtNumber vs
// formatCurrency), the unit suffixes (kWh / kW / kW / min), the `stats?.field ??
// 0` null handling, and the SummaryCard label/value/unit/loading contract.
//
// Native adaptations vs. the web source (behaviour / state / keys / units kept):
//   - react-i18next useTranslation (web L1/L43) -> native-safe t(key, fallback).
//   - `@/lib/numberFormat` fmtNumber/fmtInt (web L2) -> ported inline with the
//     web global defaults (precision 2, locale en-US; fmtInt == precision 0).
//   - `@/lib/cn` cn (web L3) -> dropped; React Native uses StyleSheet, and the
//     SummaryCard `className` becomes an optional `style` escape hatch.
//   - `@/components/ui` GlassPanel (web L4) -> native GlassPanel.
//   - `@/components/feedback` Skeleton (web L5) -> native reduced-motion-aware
//     SkeletonBar (Animated opacity pulse), the StatSkeleton precedent. The
//     web `<Skeleton className="mt-1 h-7 w-20" />` (28px tall, 80px wide) shape
//     is preserved.
//   - `@/components/motion` FadeIn (web L6, delay 0.05) -> the local FadeIn
//     (Animated.View) reproducing the web initial {opacity:0, y:12} -> animate
//     {opacity:1, y:0} easeOut entrance with a 50ms delay / 400ms duration (the
//     useMotionPreference(400) default), collapsing to the final state under
//     reduced motion (the web no-op).
//   - `@/hooks/useFormatting` formatCurrency (web L7/L44) -> ported inline as
//     `${'$'}${fmtNumber(amount, 2)}` (the web no-settings defaults: symbol '$',
//     precision 2).
//   - `./types` SummaryStats (web L8) -> ported inline (sibling native types.ts
//     not yet converted).
//   - grid `grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6` (web L48) -> a
//     native flex-wrap 2-up row (the mobile grid-cols-2 base; the lg/xl column
//     counts are web-only responsive intent on a phone-first surface).
// See the .parity.json sidecar for the line-by-line source map.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {spacing} from '../../../../../theme/tokens';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// ---- Native-safe number + currency formatting ------------------------------
// Ported from web/src/lib/numberFormat.ts (fmtNumber/fmtInt) and the
// useFormatting().formatCurrency contract. The web globals default to precision
// 2 / locale en-US until useSettings overrides them; this parity tree has no
// settings wiring, so the web defaults are used directly. formatCurrency keeps
// the web `${currencySymbol}${fmtNumber(amount, decimals)}` shape with the
// no-settings currency symbol '$'.

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

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

function formatCurrency(amount: number, decimals = DEFAULT_PRECISION): string {
  return `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`;
}

// ---- Types (ported from ./types.ts) ----------------------------------------

interface SummaryStats {
  totalSessions: number;
  totalEnergy: number;
  avgRate: number;
  peakRate: number;
  avgDuration: number;
  totalCost: number;
}

// ---- Reduced-motion awareness (web prefers-reduced-motion) ------------------

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

// ---- Reduced-motion-aware Skeleton (web @/components/feedback Skeleton) ------
// Reproduces the web `animate-pulse bg-gray-700 rounded` pulse with Animated
// opacity 1 -> 0.5 -> 1; reduced motion freezes it at a dim steady state.

const OPACITY_BRIGHT = 1;
const OPACITY_DIM = 0.5;
const REDUCED_MOTION_OPACITY = 0.75;
const PULSE_DURATION_MS = 1000;
const SKELETON_COLOR = '#374151';

function SkeletonBar({
  height,
  reduceMotion,
  width,
}: {
  height: number;
  reduceMotion: boolean;
  width: number;
}): React.ReactElement {
  const pulse = useRef(new Animated.Value(OPACITY_BRIGHT)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(REDUCED_MOTION_OPACITY);
      return;
    }

    pulse.setValue(OPACITY_BRIGHT);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: OPACITY_DIM,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: OPACITY_BRIGHT,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.bar, {height, opacity: pulse, width}]}
    />
  );
}

// ---- Reduced-motion-aware FadeIn (web @/components/motion FadeIn) ------------
// web FadeIn delay prop (0.05s) + useMotionPreference(400) duration + initial
// {opacity:0, y:12}. Reduced motion collapses to the final state (the web no-op).

const FADE_IN_DELAY_MS = 50;
const FADE_IN_DURATION_MS = 400;
const FADE_IN_TRANSLATE_Y = 12;

function FadeIn({
  children,
  reduceMotion,
}: {
  children: React.ReactNode;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: FADE_IN_DELAY_MS,
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [FADE_IN_TRANSLATE_Y, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// ---- SummaryCard (web L10-36) ----------------------------------------------
// Web: GlassPanel(p-4 min-w-0 overflow-hidden) with an uppercase label, then a
// loading Skeleton OR a semibold value with an optional small unit suffix.
// `reduceMotion` is a native-only addition driving the loading SkeletonBar.

function SummaryCard({
  label,
  value,
  unit,
  loading,
  reduceMotion,
  style,
}: {
  label: string;
  value: string;
  unit?: string;
  loading?: boolean;
  reduceMotion: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <GlassPanel style={[styles.card, style]}>
      <AppText
        numberOfLines={1}
        style={styles.label}
        tone="secondary"
        variant="caption">
        {label}
      </AppText>
      {loading ? (
        <SkeletonBar height={28} reduceMotion={reduceMotion} width={80} />
      ) : (
        <AppText numberOfLines={1} style={styles.value} weight="semibold">
          {value}
          {unit ? (
            <AppText tone="secondary" variant="caption">
              {` ${unit}`}
            </AppText>
          ) : null}
        </AppText>
      )}
    </GlassPanel>
  );
}

// ---- Component (web L38-80) -------------------------------------------------

interface SummaryStatsGridProps {
  stats: SummaryStats | null;
}

export default function SummaryStatsGrid({stats}: SummaryStatsGridProps) {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();

  return (
    <FadeIn reduceMotion={reduceMotion}>
      <View style={styles.grid}>
        <SummaryCard
          label={t('charging.curve.totalSessions', 'Total Sessions')}
          reduceMotion={reduceMotion}
          value={fmtInt(stats?.totalSessions ?? 0)}
        />
        <SummaryCard
          label={t('charging.curve.totalEnergy', 'Total Energy')}
          reduceMotion={reduceMotion}
          unit="kWh"
          value={fmtNumber(stats?.totalEnergy ?? 0)}
        />
        <SummaryCard
          label={t('charging.curve.avgChargeRate', 'Avg Charge Rate')}
          reduceMotion={reduceMotion}
          unit="kW"
          value={fmtNumber(stats?.avgRate ?? 0)}
        />
        <SummaryCard
          label={t('charging.curve.peakRate', 'Peak Rate')}
          reduceMotion={reduceMotion}
          unit="kW"
          value={fmtNumber(stats?.peakRate ?? 0)}
        />
        <SummaryCard
          label={t('charging.curve.avgDuration', 'Avg Duration')}
          reduceMotion={reduceMotion}
          unit="min"
          value={fmtInt(stats?.avgDuration ?? 0)}
        />
        <SummaryCard
          label={t('charging.curve.totalCost', 'Total Cost')}
          reduceMotion={reduceMotion}
          value={formatCurrency(stats?.totalCost ?? 0)}
        />
      </View>
    </FadeIn>
  );
}

const GRID_GAP = 16;
const CARD_PADDING = 16;

const styles = StyleSheet.create({
  bar: {
    backgroundColor: SKELETON_COLOR,
    borderRadius: 4,
  },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 0,
    overflow: 'hidden',
    padding: CARD_PADDING,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  label: {
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 18,
  },
});
