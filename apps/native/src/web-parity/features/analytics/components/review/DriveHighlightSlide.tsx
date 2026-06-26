// Native parity port of
// web/src/features/analytics/components/review/DriveHighlightSlide.tsx.
//
// The web module is one "Year in Review" slide: it spotlights a single drive
// highlight (longest / shortest / most- / least-efficient). When the drive is
// null it centers the slide's emoji over a "No drive data for this year"
// message. When a drive is present it animates an emoji (spring pop-in), an
// uppercase label (slide-up), and a glass card (slide-up) holding the route
// (start -> end address), a three-column stats grid (distance / duration /
// efficiency), and the drive date.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • @/components/motion `motion` (framer-motion re-export) -> local
//     Animated.View wrappers: PopIn reproduces the emoji spring
//     (scale 0->1, rotate -10deg->0, stiffness 180 / damping 14) and SlideUp
//     reproduces the label/card entries (translateY 20/30 -> 0, opacity 0->1,
//     delay 0.2/0.4s, duration 0.4/0.5s, easeOut). Both honour the OS
//     reduce-motion setting via AccessibilityInfo, mirroring the FadeIn port.
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site.
//   • @/hooks/useUnits (unitPrefs.distance) -> derived from the native
//     useSettings() query exactly like web useUnits' deriveDistance:
//     unit_of_length === 'mi' ? 'mi' : 'km'.
//   • @/lib/unitConversion convertDistanceFromSI -> inlined for the km/mi cases
//     this caller uses (meters / 1000 or meters / 1609.344), identical to the
//     web lib constants.
//   • lucide-react MapPin / Clock / Zap / ArrowRight -> the native SemanticIcon
//     glyphs (location / clock / bolt / forward) rendered inline as muted text,
//     matching their small inline web usage.
//   • DOM <div>/<span>/<p> + Tailwind classes -> React Native View/AppText with
//     StyleSheet tokens; text-[var(--text-secondary/muted)] -> tone secondary /
//     muted, text-white -> tone primary, truncate -> numberOfLines={1}.
//   • type YearReviewDriveHighlight from @/api/types -> imported from the native
//     web-parity api/types; the {drive | null, label, emoji} prop shape is kept.
// No DOM elements, react-i18next, lucide-react, framer-motion, Recharts,
// Leaflet, react-dom, or web UI-kit modules are imported into the native output.

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
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {YearReviewDriveHighlight} from '../../../../api/types';

// web source constant: 1 mile = 1.609344 km (used to scale Wh/km -> Wh/mi).
const KM_PER_MILE = 1.609344;
// web @/lib/unitConversion distance constants (km / mi cases only).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const EM_DASH = '\u2014';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/hooks/useUnits distance preference ─────────────────────── */

type DistanceUnit = 'km' | 'mi';

// web useUnits' deriveDistance: 'mi' selects miles, everything else km.
function deriveDistance(unitOfLength: string | undefined): DistanceUnit {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

// web @/lib/unitConversion convertDistanceFromSI (km / mi branches): pure SI
// meters -> display distance.
function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
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

// web motion.span emoji: initial {scale: 0, rotate: -10}, animate {scale: 1,
// rotate: 0}, transition {type: 'spring', stiffness: 180, damping: 14}. A single
// 0->1 spring driver feeds the scale and rotation interpolations; reduced motion
// renders the final (settled) state with no entry animation.
function PopIn({children, style}: {children: ReactNode; style?: object}) {
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
      stiffness: 180,
      damping: 14,
      mass: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  const animatedStyle = reduceMotion
    ? null
    : {
        transform: [
          {scale: progress},
          {
            rotate: progress.interpolate({
              inputRange: [0, 1],
              outputRange: ['-10deg', '0deg'],
            }),
          },
        ],
      };

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// web motion.p / motion.div entries: initial {y, opacity: 0}, animate {y: 0,
// opacity: 1}, transition {delay, duration} with framer easeOut. `distance` is
// the framer `y` offset (20 for the label, 30 for the card); `delay`/`duration`
// are seconds. Reduced motion renders the resting state immediately.
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

/* ─── inline lucide glyph (web small inline icons) ─────────────────────── */

// Small inline icon: the muted SemanticIcon glyph standing in for a lucide icon
// (MapPin -> location, Clock -> clock, Zap -> bolt, ArrowRight -> forward).
function InlineIcon({name}: {name: SemanticIconName}) {
  return (
    <AppText style={styles.inlineIcon} tone="muted" weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

/* ─── DriveHighlightSlide ──────────────────────────────────────────────── */

interface Props {
  drive: YearReviewDriveHighlight | null;
  label: string;
  emoji: string;
}

export function DriveHighlightSlide({drive, label, emoji}: Props) {
  const {t} = useTranslation();
  const {data: settings} = useSettings();
  const distanceUnit = deriveDistance(settings?.unit_of_length);
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  if (!drive) {
    return (
      <View style={styles.container}>
        <AppText style={styles.emptyEmoji}>{emoji}</AppText>
        <AppText style={styles.emptyText} tone="secondary">
          {t('yearReview.noDriveData', 'No drive data for this year')}
        </AppText>
      </View>
    );
  }

  const hours = Math.floor(drive.duration_min / 60);
  const mins = drive.duration_min % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  // backend `distance_km` is SI km; `efficiency_wh_km` is SI Wh/km.
  const distDisplay = convertDistanceFromSI(drive.distance_km * 1000, distanceUnit);
  const effDisplay =
    distanceUnit === 'mi'
      ? drive.efficiency_wh_km * KM_PER_MILE
      : drive.efficiency_wh_km;

  return (
    <View style={styles.container}>
      <PopIn style={styles.emojiWrap}>
        <AppText style={styles.emoji}>{emoji}</AppText>
      </PopIn>

      <SlideUp distance={20} delay={0.2} duration={0.4}>
        <AppText style={styles.label} tone="secondary">
          {label}
        </AppText>
      </SlideUp>

      <SlideUp distance={30} delay={0.4} duration={0.5} style={styles.card}>
        {/* Route */}
        <View style={styles.routeRow}>
          <InlineIcon name="location" />
          <AppText numberOfLines={1} style={styles.routeAddress} tone="secondary">
            {drive.start_address || EM_DASH}
          </AppText>
          <InlineIcon name="forward" />
          <AppText numberOfLines={1} style={styles.routeAddress} tone="secondary">
            {drive.end_address || EM_DASH}
          </AppText>
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCol}>
            <AppText style={styles.statValue} weight="bold">
              {Math.round(distDisplay)}
            </AppText>
            <AppText style={styles.statUnit} tone="muted">
              {distanceUnit}
            </AppText>
          </View>
          <View style={styles.statCol}>
            <View style={styles.statIconRow}>
              <InlineIcon name="clock" />
              <AppText style={styles.statValue} weight="bold">
                {durationStr}
              </AppText>
            </View>
            <AppText style={styles.statUnit} tone="muted">
              {t('yearReview.duration', 'duration')}
            </AppText>
          </View>
          <View style={styles.statCol}>
            <View style={styles.statIconRow}>
              <InlineIcon name="bolt" />
              <AppText style={styles.statValue} weight="bold">
                {drive.efficiency_wh_km > 0 ? Math.round(effDisplay) : EM_DASH}
              </AppText>
            </View>
            <AppText style={styles.statUnit} tone="muted">
              {efficiencyUnit}
            </AppText>
          </View>
        </View>

        {/* Date */}
        <AppText style={styles.date} tone="muted">
          {drive.date}
        </AppText>
      </SlideUp>
    </View>
  );
}

DriveHighlightSlide.displayName = 'DriveHighlightSlide';

const styles = StyleSheet.create({
  // web: flex flex-col items-center justify-center h-full px-8 text-center.
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  // web no-drive emoji: text-6xl mb-4.
  emptyEmoji: {
    fontSize: 60,
    lineHeight: 68,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  // web no-drive copy: text-xl text-[var(--text-secondary)].
  emptyText: {
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
  },
  emojiWrap: {
    marginBottom: spacing.md,
  },
  // web emoji: text-5xl md:text-6xl mb-4.
  emoji: {
    fontSize: 56,
    lineHeight: 64,
    textAlign: 'center',
  },
  // web label: text-lg uppercase tracking-wider mb-3.
  label: {
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  // web card: bg-white/[0.05] rounded-2xl p-6 max-w-sm w-full border white/[0.08].
  card: {
    width: '100%',
    maxWidth: 384,
    alignSelf: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  // web route row: flex items-center gap-2 mb-4 text-sm.
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  routeAddress: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  // web stats grid: grid-cols-3 gap-3.
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  // web stat value: text-2xl font-bold text-white.
  statValue: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
  },
  // web stat caption: text-xs text-[var(--text-muted)].
  statUnit: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  // web date: text-xs text-[var(--text-muted)] mt-4.
  date: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  inlineIcon: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.3,
  },
});
