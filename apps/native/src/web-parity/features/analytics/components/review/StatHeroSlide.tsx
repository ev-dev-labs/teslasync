// Native parity port of
// web/src/features/analytics/components/review/StatHeroSlide.tsx.
//
// The web module is one "Year in Review" slide: it spotlights a single headline
// stat (distance or energy). It animates an emoji (spring pop-in), a large
// count-up number, a unit caption, and a comparison line — each entering with a
// staggered slide-up. getStatConfig() maps the `field` prop ('distance' /
// 'energy' / anything else) to {emoji, value, decimals, unit, comparison}, doing
// the SI -> display-unit math for distance and the human-readable comparison
// copy for both.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • @/components/data-display AnimatedNumber -> a local AnimatedNumber that
//     reproduces the web rAF count-up exactly: ease-out-quad (1-(1-p)^2) from 0
//     to `value` over `duration` seconds, rendering fmtNumber(display, decimals)
//     in an AppText. tabular-nums -> fontVariant: ['tabular-nums']. It also
//     honours the OS reduce-motion setting (jump to the final value), matching
//     the slide's other entry animations.
//   • @/components/motion `motion` (framer-motion re-export) -> local
//     Animated.View wrappers: PopIn reproduces the emoji spring (scale 0->1,
//     rotate -20deg->0, stiffness 200 / damping 15) and SlideUp reproduces the
//     number/unit/comparison entries (translateY 40/20/20 -> 0, opacity 0->1,
//     delay 0.3/0.6/0.9s, duration 0.5/0.4/0.4s, framer easeOut). Both honour
//     reduce-motion via AccessibilityInfo, mirroring the FadeIn port.
//   • react-i18next useTranslation() + i18next TFunction -> a local
//     useTranslation() whose t supports BOTH call shapes used here:
//     t(key, fallbackString) and t(key, {defaultValue, ...interpolation}). It
//     returns the English defaultValue/fallback (or the key) and interpolates
//     {{name}} placeholders exactly like react-i18next, preserving every key.
//   • @/hooks/useUnits (unitPrefs.distance + global locale) -> derived from the
//     native useSettings() query: deriveDistance(unit_of_length) and
//     deriveLocale(locale), matching web useUnits/numberFormat global locale.
//   • @/lib/unitConversion convertDistanceFromSI + DistanceUnitPref -> inlined
//     for the km/mi cases this caller uses (meters / 1000 or meters / 1609.344),
//     identical to the web lib constants.
//   • @/lib/numberFormat fmtNumber -> inlined locale-aware toLocaleString helper
//     (min=max fraction digits), identical to the web lib.
//   • type YearReview from @/api/types -> imported from the native web-parity
//     api/types; the {data, field} Props shape is kept verbatim.
//   • DOM <div>/<span>/<p> + Tailwind classes -> React Native View/AppText with
//     StyleSheet tokens; text-[var(--text-secondary/muted)] -> tone secondary /
//     muted, text-white -> AppText default primary tone.
// No DOM elements, react-i18next, framer-motion, Recharts, Leaflet, react-dom,
// or web UI-kit modules are imported into the native output.

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
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {YearReview} from '../../../../api/types';

// web @/lib/unitConversion distance constants (km / mi cases only).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
// web getStatConfig: Earth's equatorial circumference in km (distance / 40075).
const EARTH_CIRCUMFERENCE_KM = 40075;
const DEFAULT_LOCALE = 'en-US';

/* ─── i18n fallback (web react-i18next useTranslation + i18next TFunction) ── */

type TInterpolation = {defaultValue?: string} & Record<
  string,
  string | number | undefined
>;
type TFunc = (key: string, fallback?: string | TInterpolation) => string;

// react-i18next interpolation: replace {{name}} (with optional surrounding
// whitespace) using the provided values, exactly like the web call sites.
function interpolate(template: string, values: TInterpolation): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = values[name];
    return value == null ? match : String(value);
  });
}

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. Supports the two web shapes — t(key, fallback) and
// t(key, {defaultValue, ...interpolation}) — and interpolates {{var}} tokens.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    if (fallback) {
      const template = fallback.defaultValue ?? key;
      return interpolate(template, fallback);
    }
    return key;
  }, []);
  return {t};
}

/* ─── inlined @/hooks/useUnits distance preference + locale ─────────────── */

// web @/lib/unitConversion DistanceUnitPref (km / mi branches this caller hits).
type DistanceUnit = 'km' | 'mi';

// web useUnits' deriveDistance: 'mi' selects miles, everything else km.
function deriveDistance(unitOfLength: string | undefined): DistanceUnit {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

// web useUnits/numberFormat global locale: settings.locale when non-empty.
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// web @/lib/unitConversion convertDistanceFromSI (km / mi branches): pure SI
// meters -> display distance.
function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max), falling back to en-US for bad locales.
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

/* ─── reduce-motion-aware entry animations (web @/components/motion) ────── */

// framer 'easeOut' is the cubic-bezier(0, 0, 0.58, 1) curve (matches FadeIn).
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);

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

// web motion.span emoji: initial {scale: 0, rotate: -20}, animate {scale: 1,
// rotate: 0}, transition {type: 'spring', stiffness: 200, damping: 15}. A single
// 0->1 spring driver feeds the scale and rotation interpolations; reduced motion
// renders the final (settled) state with no entry animation.
function PopIn({
  children,
  style,
  fromRotate,
  stiffness,
  damping,
}: {
  children: ReactNode;
  style?: object;
  fromRotate: string;
  stiffness: number;
  damping: number;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.spring(progress, {
      toValue: 1,
      stiffness,
      damping,
      mass: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [damping, progress, reduceMotion, stiffness]);

  const animatedStyle = reduceMotion
    ? null
    : {
        transform: [
          {scale: progress},
          {
            rotate: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [fromRotate, '0deg'],
            }),
          },
        ],
      };

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// web motion.div / motion.p entries: initial {y, opacity: 0}, animate {y: 0,
// opacity: 1}, transition {delay, duration} with framer easeOut. `distance` is
// the framer `y` offset; `delay`/`duration` are seconds. Reduced motion renders
// the resting state immediately.
function SlideUp({
  children,
  distance,
  delay,
  duration,
  style,
}: {
  children: ReactNode;
  distance: number;
  delay: number;
  duration: number;
  style?: object;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: duration * 1000,
      delay: delay * 1000,
      easing: EASE_OUT,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delay, duration, progress, reduceMotion]);

  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [distance, 0],
            }),
          },
        ],
      };

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/* ─── count-up number (web @/components/data-display AnimatedNumber) ────── */

// web AnimatedNumber: a requestAnimationFrame loop eases (ease-out quad,
// 1-(1-p)^2) from 0 to `value` over `duration` seconds, rendering
// fmtNumber(display, decimals) with tabular-nums. Reduced motion jumps straight
// to the final value (same final output, no in-between frames).
function AnimatedNumber({
  value,
  duration,
  decimals,
  locale,
  style,
}: {
  value: number;
  duration: number;
  decimals: number;
  locale: string;
  style?: TextStyle;
}) {
  const reduceMotion = useReduceMotion();
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value);
      return;
    }

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

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [decimals, duration, reduceMotion, value]);

  return (
    <AppText weight="bold" style={[styles.heroNumber, style]}>
      {fmtNumber(display, decimals, locale)}
    </AppText>
  );
}

/* ─── StatHeroSlide ────────────────────────────────────────────────────── */

interface Props {
  data: YearReview;
  field: string;
}

interface StatConfig {
  emoji: string;
  value: number;
  decimals: number;
  unit: string;
  comparison: string;
}

export function StatHeroSlide({data, field}: Props) {
  const {t} = useTranslation();
  const {data: settings} = useSettings();
  const distanceUnit = deriveDistance(settings?.unit_of_length);
  const locale = deriveLocale(settings?.locale);

  const config = getStatConfig(data, field, t, distanceUnit, locale);

  return (
    <View style={styles.container}>
      <PopIn
        style={styles.emojiWrap}
        fromRotate="-20deg"
        stiffness={200}
        damping={15}>
        <AppText style={styles.emoji}>{config.emoji}</AppText>
      </PopIn>

      <SlideUp distance={40} delay={0.3} duration={0.5}>
        <AnimatedNumber
          value={config.value}
          duration={1.5}
          decimals={config.decimals}
          locale={locale}
        />
      </SlideUp>

      <SlideUp distance={20} delay={0.6} duration={0.4} style={styles.unitWrap}>
        <AppText style={styles.unit} tone="secondary">
          {config.unit}
        </AppText>
      </SlideUp>

      <SlideUp
        distance={20}
        delay={0.9}
        duration={0.4}
        style={styles.comparisonWrap}>
        <AppText style={styles.comparison} tone="muted">
          {config.comparison}
        </AppText>
      </SlideUp>
    </View>
  );
}

StatHeroSlide.displayName = 'StatHeroSlide';

// web getStatConfig: maps `field` -> headline stat. `locale` threads the web
// numberFormat global locale (read implicitly by fmtNumber on web) explicitly,
// since the native port has no global locale singleton.
function getStatConfig(
  data: YearReview,
  field: string,
  t: TFunc,
  distanceUnit: DistanceUnit,
  locale: string,
): StatConfig {
  switch (field) {
    case 'distance': {
      // backend `total_distance_km` is SI km; convert via meter floor.
      const dist = convertDistanceFromSI(
        data.total_distance_km * 1000,
        distanceUnit,
      );
      const earthLaps = data.total_distance_km / EARTH_CIRCUMFERENCE_KM;
      return {
        emoji: '🛣️',
        value: dist,
        decimals: 0,
        unit: distanceUnit,
        comparison:
          earthLaps >= 0.01
            ? t('yearReview.distanceComparison', {
                percent: fmtNumber(earthLaps * 100, 1, locale),
                defaultValue: "That's {{percent}}% around the Earth!",
              })
            : t('yearReview.distanceSmall', 'Every kilometer counts!'),
      };
    }
    case 'energy':
      return {
        emoji: '⚡',
        value: data.total_energy_kwh,
        decimals: 0,
        unit: t('yearReview.energyUnit', 'kWh charged'),
        comparison: t('yearReview.energyComparison', {
          days: Math.round(data.total_energy_kwh / 30),
          defaultValue: 'Enough to power a home for {{days}} days',
        }),
      };
    default:
      return {
        emoji: '📊',
        value: 0,
        decimals: 0,
        unit: '',
        comparison: '',
      };
  }
}

const styles = StyleSheet.create({
  // web: flex flex-col items-center justify-center h-full px-8 text-center.
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  // web emoji: text-6xl md:text-8xl mb-6.
  emojiWrap: {
    marginBottom: 24,
  },
  emoji: {
    fontSize: 60,
    lineHeight: 68,
    textAlign: 'center',
  },
  // web number: text-6xl md:text-8xl font-bold text-white (tabular-nums).
  heroNumber: {
    color: colors.textPrimary,
    fontSize: 60,
    lineHeight: 68,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  // web unit: text-xl md:text-2xl text-[var(--text-secondary)] mt-3.
  unitWrap: {
    marginTop: 12,
  },
  unit: {
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
  },
  // web comparison: text-lg text-[var(--text-muted)] mt-6 max-w-md.
  comparisonWrap: {
    marginTop: 24,
    maxWidth: 448,
    alignSelf: 'center',
  },
  comparison: {
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
});
