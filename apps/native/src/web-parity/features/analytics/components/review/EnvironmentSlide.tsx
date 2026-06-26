// Native parity port of
// web/src/features/analytics/components/review/EnvironmentSlide.tsx.
//
// `EnvironmentSlide` is one slide of the Year-in-Review story deck. It celebrates
// the vehicle's CO₂ offset: a spring "pop" globe emoji, an uppercase "CO₂ offset"
// label, the offset value counting up from 0 (kg), a "like planting N trees"
// caption, and a staggered grid of 🌳 emojis (one per ~21 kg, capped at 30 with a
// "+N more" chip). Behaviour is preserved verbatim: `treesPlanted =
// round(co2_offset_kg / 21)` and `treeIcons` is `[0 .. min(treesPlanted, 30))`.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - `AnimatedNumber` (@/components/data-display, not yet ported) -> inlined here
//     as a native `Animated`-driven count-up with the same
//     value/duration/decimals/prefix/suffix API and ease-out-quad 0->value tween,
//     formatting each frame through an inlined `fmtNumber` (the same toLocaleString
//     min/max-fraction-digits logic as @/lib/numberFormat). `tabular-nums` (always
//     applied by the web `cn('tabular-nums', className)`) becomes fontVariant.
//   - framer-motion `motion.*` (@/components/motion) -> the declarative
//     initial/animate/transition API has no native surface, so each entrance is
//     reproduced imperatively with `Animated`: the globe + tree pops use
//     `Animated.spring` (the globe keeping the source's stiffness 200 / damping 15);
//     the label/number/caption/grid fade+slide use `Animated.timing` with the
//     source delays/durations and an ease-out curve (matching the existing motion
//     barrel port). All entrances honour reduced motion (final state, no tween).
//   - react-i18next `useTranslation` -> the standard local fallback shim returning
//     the inline English copy; the `{{count}}` interpolation used by
//     `yearReview.treesEquiv` is reproduced so i18n intent (keys + count) is kept.
//   - `YearReview` type -> imported from the ported native `../../../../api/types`.
//
// DOM -> native element mapping:
//   - outer `<div class="flex flex-col items-center justify-center h-full px-8
//     text-center">` -> a View (flex:1, column, centred, paddingHorizontal 32).
//   - `<motion.span class="text-5xl mb-4">🌍</motion.span>` -> an Animated.View
//     (scale spring) wrapping an AppText glyph (48px).
//   - `<motion.p class="text-lg ... uppercase tracking-wider mb-4">` -> AppText
//     (18px, secondary, uppercase, letterSpacing 0.9 = 0.05em·18, mb 16).
//   - `<motion.div>` + `<AnimatedNumber class="text-5xl md:text-7xl font-bold
//     text-green-400">` -> the count-up in 48px bold green-400 (#4ade80). The
//     responsive `md:text-7xl` (72px ≥768px) has no RN breakpoint, so the mobile
//     base `text-5xl` (48px) is used — documented UNAVAILABLE in the sidecar.
//   - caption `<motion.p class="text-[var(--text-muted)] mt-2 mb-8">` -> AppText
//     (16px, muted, mt 8 / mb 32).
//   - tree grid `<motion.div class="flex flex-wrap justify-center gap-2 max-w-xs">`
//     -> an Animated.View (row, wrap, centred, gap 8, maxWidth 320) of TreeIcon
//     Animated.Views (each a 24px 🌳 with its own staggered spring) plus, when
//     `treesPlanted > 30`, a "+N more" AppText (14px muted, self-end, ml 4).
//
// Colour mapping: green-400 keeps its literal #4ade80 (no semantic token);
// `--text-secondary`/`--text-muted` map to colors.textSecondary/textMuted. No
// DOM-only modules, HTML elements, Recharts, Leaflet, or old web UI components are
// imported.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';
import type {YearReview} from '../../../../api/types';

// ── i18n shim ────────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their inline
// English fallback. The web call sites use both `t(key, fallback)` and the
// interpolating `t(key, {count, defaultValue})` (yearReview.treesEquiv), so this
// shim supports both shapes and substitutes `{{count}}` to preserve i18n intent.
interface TOptions {
  count?: number;
  defaultValue: string;
}
type TFunc = (key: string, fallback: string | TOptions) => string;

function useTranslation(): {t: TFunc} {
  const t: TFunc = (_key, fallback) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    if (fallback.count === undefined) {
      return fallback.defaultValue;
    }
    return fallback.defaultValue.split('{{count}}').join(String(fallback.count));
  };
  return {t};
}

// ── Reduced-motion preference ────────────────────────────────────────────────
// Mirrors the other web-parity ports: framer-motion's implicit reduced-motion
// support becomes an explicit `AccessibilityInfo` subscription so every entrance
// can collapse to its final state.
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

// ── Number formatting (inlined from @/lib/numberFormat) ──────────────────────
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 0, locale = 'en-US'): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// ── AnimatedNumber (inlined native parity of @/components/data-display) ───────
// Counts up from 0 to `value` over `duration` seconds with an ease-out-quad tween,
// formatting each frame through `fmtNumber`. `tabular-nums` is always applied (the
// web `cn('tabular-nums', className)`). Honours reduced motion by jumping straight
// to the final value.
interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduce) {
      progress.stopAnimation();
      progress.setValue(value);
      setDisplay(value);
      return;
    }

    progress.setValue(0);
    const listenerId = progress.addListener(({value: current}) => {
      setDisplay(current);
    });
    const animation = Animated.timing(progress, {
      toValue: value,
      duration: duration * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    });
    animation.start();

    return () => {
      animation.stop();
      progress.removeListener(listenerId);
    };
  }, [duration, progress, reduce, value]);

  return (
    <AppText style={[styles.tabularNums, style]}>
      {`${prefix ?? ''}${fmtNumber(display, decimals)}${suffix ?? ''}`}
    </AppText>
  );
}

// ── Entrance animations (native parity of framer-motion initial/animate) ─────
// A timing tween drives an Animated.Value 0->1 after `delay` seconds over
// `duration` seconds; consumers interpolate opacity / translateY from it.
function useTimingEntrance(
  delay: number,
  duration: number,
  reduce: boolean,
): Animated.Value {
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: duration * 1000,
      delay: delay * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();

    return () => animation.stop();
  }, [delay, duration, progress, reduce]);

  return progress;
}

interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

// Globe keeps the source spring (stiffness 200 / damping 15); the trees use a
// framer default-style spring (`type: 'spring'` with no explicit physics).
const GLOBE_SPRING: SpringConfig = {stiffness: 200, damping: 15, mass: 1};
const TREE_SPRING: SpringConfig = {stiffness: 180, damping: 14, mass: 1};

// A spring drives an Animated.Value 0->1 (overshooting for the "pop") after a
// `delay`; consumers interpolate scale / translateY from it.
function useSpringEntrance(
  delay: number,
  reduce: boolean,
  config: SpringConfig,
): Animated.Value {
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.sequence([
      Animated.delay(delay * 1000),
      Animated.spring(progress, {
        toValue: 1,
        stiffness: config.stiffness,
        damping: config.damping,
        mass: config.mass,
        useNativeDriver: true,
      }),
    ]);
    animation.start();

    return () => animation.stop();
  }, [config, delay, progress, reduce]);

  return progress;
}

// ── Tree glyph (staggered spring pop, parity of the inner motion.span) ───────
// Web: initial {scale:0, y:10} -> animate {scale:1, y:0}, spring, delay
// `1.1 + i * 0.05`. Reproduced per-icon so the grid pops in one tree at a time.
function TreeIcon({index, reduce}: {index: number; reduce: boolean}) {
  const progress = useSpringEntrance(1.1 + index * 0.05, reduce, TREE_SPRING);

  return (
    <Animated.View
      style={{
        transform: [
          {scale: progress},
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [10, 0],
            }),
          },
        ],
      }}>
      <AppText style={styles.tree}>🌳</AppText>
    </Animated.View>
  );
}

interface Props {
  data: YearReview;
}

export function EnvironmentSlide({data}: Props) {
  const {t} = useTranslation();
  const reduce = useReduceMotion();

  const treesPlanted = useMemo(
    () => Math.round(data.co2_offset_kg / 21),
    [data.co2_offset_kg],
  );
  const treeIcons = useMemo(() => {
    const count = Math.min(treesPlanted, 30);
    return Array.from({length: count}, (_, i) => i);
  }, [treesPlanted]);

  // framer-motion entrances (delay/duration in seconds, matching the source).
  const globe = useSpringEntrance(0, reduce, GLOBE_SPRING);
  const label = useTimingEntrance(0.2, 0.4, reduce);
  const number = useTimingEntrance(0.4, 0.5, reduce);
  const caption = useTimingEntrance(0.8, 0.4, reduce);
  const grid = useTimingEntrance(1, 0.5, reduce);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.globeWrap, {transform: [{scale: globe}]}]}>
        <AppText style={styles.globe}>🌍</AppText>
      </Animated.View>

      <Animated.View
        style={{
          opacity: label,
          transform: [
            {
              translateY: label.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
          ],
        }}>
        <AppText style={styles.label}>
          {t('yearReview.co2Offset', 'CO₂ offset')}
        </AppText>
      </Animated.View>

      <Animated.View
        style={{
          opacity: number,
          transform: [
            {
              translateY: number.interpolate({
                inputRange: [0, 1],
                outputRange: [30, 0],
              }),
            },
          ],
        }}>
        <AnimatedNumber
          value={data.co2_offset_kg}
          duration={1.5}
          suffix=" kg"
          style={styles.number}
        />
      </Animated.View>

      <Animated.View style={{opacity: caption}}>
        <AppText style={styles.trees}>
          {t('yearReview.treesEquiv', {
            count: treesPlanted,
            defaultValue: 'Like planting {{count}} trees',
          })}
        </AppText>
      </Animated.View>

      {/* Tree grid visualization */}
      <Animated.View style={[styles.grid, {opacity: grid}]}>
        {treeIcons.map(i => (
          <TreeIcon key={i} index={i} reduce={reduce} />
        ))}
        {treesPlanted > 30 && (
          <AppText style={styles.more}>
            +{treesPlanted - 30} {t('yearReview.more', 'more')}
          </AppText>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center', // items-center
    flex: 1, // h-full
    justifyContent: 'center', // justify-center
    paddingHorizontal: 32, // px-8
  },
  globeWrap: {
    marginBottom: 16, // mb-4
  },
  globe: {
    fontSize: 48, // text-5xl
    lineHeight: 48,
    textAlign: 'center',
  },
  label: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 18, // text-lg
    letterSpacing: 0.9, // tracking-wider (0.05em * 18)
    lineHeight: 28,
    marginBottom: 16, // mb-4
    textAlign: 'center',
    textTransform: 'uppercase', // uppercase
  },
  number: {
    color: '#4ade80', // text-green-400 (md:text-7xl not applied — no RN breakpoint)
    fontSize: 48, // text-5xl
    fontWeight: '700', // font-bold
    lineHeight: 48,
    textAlign: 'center',
  },
  trees: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 16, // base
    lineHeight: 24,
    marginBottom: 32, // mb-8
    marginTop: 8, // mt-2
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row', // flex
    flexWrap: 'wrap', // flex-wrap
    gap: 8, // gap-2
    justifyContent: 'center', // justify-center
    maxWidth: 320, // max-w-xs
  },
  tree: {
    fontSize: 24, // text-2xl
    lineHeight: 32,
    textAlign: 'center',
  },
  more: {
    alignSelf: 'flex-end', // self-end
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 14, // text-sm
    lineHeight: 20,
    marginLeft: 4, // ml-1
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
});
