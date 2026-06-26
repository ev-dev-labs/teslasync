// Native parity port of
// web/src/features/analytics/components/review/PatternsSlide.tsx.
//
// PatternsSlide is one slide of the Year-In-Review story: a centred 📊 emoji, a
// "Your driving patterns" subtitle, two info cards (favourite driving day +
// peak driving hour) and a three-column stats footer (drives/week, distance/
// drive, efficiency). Every state derivation, unit computation, i18n key and
// visual affordance is preserved; only the web stack with no native analogue is
// moved behind a native-safe substitute (conversion-contract rules 4-7):
//   - framer-motion `motion.span` / `motion.p` / `motion.div` entrances
//     (`initial`/`animate`/`transition`: a spring scale-in for the emoji and
//     fade+slide-in cards/footer with staggered delays) -> the local MotionView
//     (Animated.View) which reproduces each from-state, delay and duration and
//     collapses to the final state under reduced motion (AccessibilityInfo, the
//     native `prefers-reduced-motion`).
//   - `react-i18next` useTranslation -> a native-safe (key, fallback, values)
//     shim; all i18n keys + English fallbacks and the `{{unit}}` interpolation
//     are copied verbatim.
//   - `useUnits().unitPrefs.distance` reads the settings provider for the
//     distance preference. The parity tree has no settings provider (see
//     ActiveVehicleSegment / Delta), so the distance unit defaults to the web
//     no-settings value (`deriveDistance(undefined) === 'km'`) and may be
//     overridden by the host via the optional `distanceUnit` prop.
//   - `convertDistanceFromSI` (`@/lib/unitConversion`) + `fmtNumber`
//     (`@/lib/numberFormat`) are ported inline (the same metres->mi/km math and
//     en-US toLocaleString contract used by the sibling parity ports).
//   - lucide-react Calendar / Clock -> the SemanticIcon `calendar` / `clock`
//     glyphs rendered inline in their web indigo-400 / sky-400 accent colours.
// See the .parity.json sidecar for the line-by-line source map.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';
import type {YearReview} from '../../../../api/types';

// ---- Ported unit conversion (web @/lib/unitConversion) -----------------------

type DistanceUnit = 'km' | 'mi';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

// web PatternsSlide L9.
const KM_PER_MILE = 1.609344;

function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// ---- Ported number formatting (web @/lib/numberFormat fmtNumber) -------------
// en-US locale + safeNumber guard, matching the web no-settings defaults.

const DEFAULT_LOCALE = 'en-US';

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toFixed(decimals);
  }
}

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function interpolate(template: string, values: TranslationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, values) =>
      values ? interpolate(fallback, values) : fallback,
    [],
  );
}

// ---- Reduced-motion-aware entrance animation --------------------------------
// Reproduces framer-motion `initial`/`animate`/`transition` for a single
// element: a `progress` value drives every from-state to its resting value. The
// emoji uses a spring (web `type: 'spring', stiffness: 200, damping: 15`); the
// cards/footer use timed fade+slide. Reduced motion collapses to the final
// state immediately (the native `prefers-reduced-motion` no-op).

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

interface MotionViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  reduceMotion: boolean;
  /** Web `initial` opacity (default 1 = no opacity animation). */
  opacityFrom?: number;
  /** Web `initial` x offset in px (default 0). */
  translateXFrom?: number;
  /** Web `initial` y offset in px (default 0). */
  translateYFrom?: number;
  /** Web `initial` scale (default 1). */
  scaleFrom?: number;
  /** Web `transition.delay` in seconds, converted to ms. */
  delayMs: number;
  /** Web `transition.duration` in seconds, converted to ms (timing only). */
  durationMs: number;
  /** Web `transition.type: 'spring'`. */
  spring?: boolean;
}

function MotionView({
  children,
  style,
  reduceMotion,
  opacityFrom = 1,
  translateXFrom = 0,
  translateYFrom = 0,
  scaleFrom = 1,
  delayMs,
  durationMs,
  spring = false,
}: MotionViewProps): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = spring
      ? Animated.spring(progress, {
          delay: delayMs,
          toValue: 1,
          stiffness: 200,
          damping: 15,
          mass: 1,
          useNativeDriver: true,
        })
      : Animated.timing(progress, {
          delay: delayMs,
          duration: durationMs,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, durationMs, progress, reduceMotion, spring]);

  const animatedStyle = {
    opacity: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [opacityFrom, 1],
      extrapolate: 'clamp' as const,
    }),
    transform: [
      {
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [translateXFrom, 0],
        }),
      },
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [translateYFrom, 0],
        }),
      },
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [scaleFrom, 1],
        }),
      },
    ],
  };

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// ---- Icon glyphs (web lucide Calendar / Clock) ------------------------------

const CALENDAR_GLYPH = getSemanticIconDefinition('calendar').glyph;
const CLOCK_GLYPH = getSemanticIconDefinition('clock').glyph;

// ---- Component --------------------------------------------------------------

interface Props {
  data: YearReview;
  /**
   * Distance display unit. Replaces the web `useUnits().unitPrefs.distance`
   * (settings-provider driven). Defaults to the web no-settings value 'km'.
   */
  distanceUnit?: DistanceUnit;
}

export function PatternsSlide({data, distanceUnit = 'km'}: Props): React.ReactElement {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();

  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `avg_distance_per_drive_km` is SI km; `avg_efficiency_wh_km` is SI Wh/km.
  const avgDistDisplay = convertDistanceFromSI(
    data.avg_distance_per_drive_km * 1000,
    distanceUnit,
  );
  const avgEffDisplay =
    distanceUnit === 'mi'
      ? data.avg_efficiency_wh_km * KM_PER_MILE
      : data.avg_efficiency_wh_km;

  const hourLabel =
    data.most_active_hour >= 12
      ? `${data.most_active_hour === 12 ? 12 : data.most_active_hour - 12} PM`
      : `${data.most_active_hour === 0 ? 12 : data.most_active_hour} AM`;

  return (
    <View style={styles.root}>
      <MotionView
        reduceMotion={reduceMotion}
        scaleFrom={0}
        delayMs={0}
        durationMs={0}
        spring
        style={styles.emojiWrap}>
        <AppText style={styles.emoji}>📊</AppText>
      </MotionView>

      <MotionView
        reduceMotion={reduceMotion}
        opacityFrom={0}
        translateYFrom={20}
        delayMs={200}
        durationMs={400}
        style={styles.subtitleWrap}>
        <AppText style={styles.subtitle} tone="secondary">
          {t('yearReview.drivingPatterns', 'Your driving patterns')}
        </AppText>
      </MotionView>

      <View style={styles.cards}>
        {/* Most active day */}
        <MotionView
          reduceMotion={reduceMotion}
          opacityFrom={0}
          translateXFrom={-40}
          delayMs={400}
          durationMs={500}
          style={styles.card}>
          <AppText style={[styles.icon, styles.iconCalendar]} weight="bold">
            {CALENDAR_GLYPH}
          </AppText>
          <View style={styles.cardText}>
            <AppText style={styles.cardLabel}>
              {t('yearReview.favoriteDay', 'Favorite driving day')}
            </AppText>
            <AppText style={styles.cardValue} weight="bold">
              {data.most_active_day_of_week || '—'}
            </AppText>
          </View>
        </MotionView>

        {/* Most active hour */}
        <MotionView
          reduceMotion={reduceMotion}
          opacityFrom={0}
          translateXFrom={40}
          delayMs={600}
          durationMs={500}
          style={styles.card}>
          <AppText style={[styles.icon, styles.iconClock]} weight="bold">
            {CLOCK_GLYPH}
          </AppText>
          <View style={styles.cardText}>
            <AppText style={styles.cardLabel}>
              {t('yearReview.peakHour', 'Peak driving hour')}
            </AppText>
            <AppText style={styles.cardValue} weight="bold">
              {hourLabel}
            </AppText>
          </View>
        </MotionView>

        {/* Avg drives per week */}
        <MotionView
          reduceMotion={reduceMotion}
          opacityFrom={0}
          translateYFrom={30}
          delayMs={800}
          durationMs={500}
          style={styles.statsRow}>
          <View style={styles.statCol}>
            <AppText style={styles.statValue} weight="bold">
              {fmtNumber(data.avg_drives_per_week, 1)}
            </AppText>
            <AppText style={styles.statLabel}>
              {t('yearReview.drivesWeek', 'drives/week')}
            </AppText>
          </View>
          <View style={styles.statCol}>
            <AppText style={styles.statValue} weight="bold">
              {Math.round(avgDistDisplay)}
            </AppText>
            <AppText style={styles.statLabel}>
              {t('yearReview.distancePerDrive', '{{unit}}/drive avg', {
                unit: distanceUnit,
              })}
            </AppText>
          </View>
          <View style={styles.statCol}>
            <AppText style={styles.statValue} weight="bold">
              {Math.round(avgEffDisplay)}
            </AppText>
            <AppText style={styles.statLabel}>
              {efficiencyUnit} {t('yearReview.avg', 'avg')}
            </AppText>
          </View>
        </MotionView>
      </View>
    </View>
  );
}

PatternsSlide.displayName = 'PatternsSlide';

const styles = StyleSheet.create({
  // web `flex flex-col items-center justify-center h-full px-8 text-center`.
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  // web emoji span `text-5xl mb-6`.
  emojiWrap: {
    marginBottom: 24,
  },
  emoji: {
    fontSize: 48,
    lineHeight: 56,
    textAlign: 'center',
  },
  // web subtitle `text-xl text-[var(--text-secondary)] mb-8`.
  subtitleWrap: {
    marginBottom: 32,
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
  },
  // web inner `space-y-6 max-w-sm w-full`.
  cards: {
    width: '100%',
    maxWidth: 384,
    gap: 24,
  },
  // web card `bg-white/[0.05] rounded-xl p-5 border border-white/[0.08] flex
  // items-center gap-4`.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  // web icon `h-8 w-8 ... shrink-0`.
  icon: {
    width: 32,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 32,
    letterSpacing: 0.4,
  },
  // web Calendar `text-indigo-400`.
  iconCalendar: {
    color: '#818cf8',
  },
  // web Clock `text-sky-400`.
  iconClock: {
    color: '#38bdf8',
  },
  // web `text-left` block.
  cardText: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  // web label `text-sm text-[var(--text-muted)]`.
  cardLabel: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  // web value `text-2xl font-bold text-white`.
  cardValue: {
    fontSize: 24,
    lineHeight: 30,
    color: colors.textPrimary,
  },
  // web stats `flex justify-between text-center`.
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // web column `flex-1`.
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  // web value `text-3xl font-bold text-white`.
  statValue: {
    fontSize: 30,
    lineHeight: 36,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  // web label `text-xs text-[var(--text-muted)]`.
  statLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
