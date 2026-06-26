// Native parity port of
// web/src/features/analytics/components/review/SummarySlide.tsx.
//
// `SummarySlide` is the screenshot-friendly hero card of the Year-in-Review story
// deck. It pops in a 16:9-ish glass card containing the year + vehicle header, a
// staggered list of five headline stats (drives, distance, energy, charges, CO₂),
// an optional "Saved $N vs. gas" line, a "TeslaSync • Year in Review" footer, and a
// "Screenshot to share" caption beneath the card. Behaviour is preserved verbatim:
// the five `stats` entries (icon/label/value/decimals) are built in the same order,
// the distance row reads `convertDistanceFromSI(total_distance_km * 1000, unit)`
// with its label being the raw unit string, and the savings line only renders when
// `gas_savings > 0`.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - `AnimatedNumber` (@/components/data-display, not yet ported) -> inlined here
//     as a native `Animated`-driven count-up with the same value/duration/decimals/
//     prefix/suffix API, an ease-out-quad 0->value tween, and `fmtNumber`
//     (toLocaleString min/max-fraction-digits, identical to @/lib/numberFormat).
//     `tabular-nums` (always applied by the web `cn('tabular-nums', className)`)
//     becomes fontVariant. (Same inline as the sibling EnvironmentSlide port.)
//   - framer-motion `motion.*` (@/components/motion) -> the declarative
//     initial/animate/transition API has no native surface, so each entrance is
//     reproduced imperatively with `Animated.timing`: the card scale-pop
//     (scale 0.9->1 + opacity, dur 0.6), the per-stat slide (translateX -20->0 +
//     opacity, delay 0.3 + i·0.1, dur 0.4), and the savings/screenshot fades
//     (opacity, delay 1 / 1.2, dur 0.4). All honour reduced motion (final state,
//     no tween) via an AccessibilityInfo subscription.
//   - react-i18next `useTranslation` -> the standard local fallback shim returning
//     the inline English copy; it interpolates every `{{token}}` in the options
//     object so `yearReview.savedSummary`'s `{{amount}}` keeps its i18n intent.
//   - `useUnits` (@/hooks/useUnits) -> reproduced via the native `useSettings`
//     web-parity hook + a `deriveDistance` helper copied verbatim from the web
//     `useUnits` (`unit_of_length === 'mi' ? 'mi' : 'km'`), mirroring the web
//     `useUnits -> useSettings` chain (same approach as the Speed format port).
//   - `convertDistanceFromSI` (@/lib/unitConversion) -> inlined verbatim (same
//     METERS_PER_KM/MILE/FOOT constants + 3-case switch); there is no native
//     unitConversion module to import.
//   - `YearReview` type -> imported from the ported native `../../../../api/types`.
//   - lucide-react `Zap/Car/Plug/Leaf` (SVG/DOM, no native analog) -> decorative
//     emoji glyphs (🚗 distance/drives, ⚡ energy, 🔌 charges, 🍃 CO₂) rendered in
//     AppText and hidden from assistive tech, since the adjacent value + label
//     carry the meaning (same lucide -> glyph technique as the EventTimeline port).
//
// DOM -> native element mapping:
//   - outer `<div class="flex flex-col items-center justify-center h-full px-8
//     text-center">` -> a View (flex:1, column, centred, paddingHorizontal 32).
//   - card `<motion.div class="bg-gradient-to-br from-white/[0.08] to-white/[0.02]
//     backdrop-blur-md rounded-3xl p-8 max-w-md w-full border border-white/[0.12]
//     shadow-2xl">` -> an Animated.View: borderRadius 24, padding 32, maxWidth 448,
//     width 100%, borderWidth 1 / borderColor rgba(255,255,255,0.12). The
//     two-stop gradient is flattened to a solid rgba(255,255,255,0.05) (its mid
//     point) and `backdrop-blur-md` is dropped — neither has a dependency-free RN
//     analog (documented UNAVAILABLE). `shadow-2xl` maps to the shadows.panel token.
//   - header `<div class="flex items-center justify-between mb-6">` -> a row View
//     (space-between, mb 24) with a left column and a right (flex-end) column.
//   - `<h2 class="text-2xl font-bold text-white">{year}` -> AppText 24px/700,
//     literal #ffffff (text-white, kept distinct from --text-primary below).
//   - subtitle / display_name / model -> AppText 14px secondary, 14px/500
//     --text-primary, 12px --text-muted respectively.
//   - stats `<div class="space-y-3">` -> a column View (gap 12). Each
//     `<motion.div class="flex items-center gap-3">` -> a StatRow (row, gap 12)
//     with the glyph (20px, --text-muted, fixed width = shrink-0), the AnimatedNumber
//     (20px/700 #ffffff, minWidth 64 = min-w-[4rem], left aligned), and the label
//     (14px --text-secondary).
//   - savings `<motion.div class="mt-6 pt-4 border-t border-white/[0.08]
//     text-center">` -> Animated.View (mt 24, pt 16, borderTopWidth 1 / color
//     rgba(255,255,255,0.08), centred) wrapping AppText 14px emerald-400/80
//     (rgba(52,211,153,0.8)); only rendered when gas_savings > 0.
//   - footer `<p class="text-[10px] text-[var(--text-muted)] mt-4">` -> AppText
//     10px --text-muted, mt 16.
//   - screenshot `<motion.p class="text-sm text-[var(--text-muted)] mt-6">` ->
//     Animated.View (opacity fade) wrapping AppText 14px --text-muted, mt 24.
//
// Colour mapping: text-white keeps literal #ffffff; emerald-400/80 keeps literal
// rgba(52,211,153,0.8); border-white/[0.12]/[0.08] keep literal rgba; the CSS
// vars --text-primary/secondary/muted map to colors.textPrimary/Secondary/Muted.
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useEffect, useRef, useState} from 'react';
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
import {colors, shadows} from '../../../../../theme/tokens';
import type {YearReview} from '../../../../api/types';
import {useSettings} from '../../../../api/hooks/useSettings';

// ── i18n shim ────────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their inline
// English fallback. The web call sites use both `t(key, fallback)` and the
// interpolating `t(key, {amount, defaultValue})` (yearReview.savedSummary), so this
// shim supports both shapes and substitutes every `{{token}}` (e.g. `{{amount}}`)
// from the options bag to preserve i18n intent.
interface TOptions {
  defaultValue: string;
  [token: string]: string | number;
}
type TFunc = (key: string, fallback: string | TOptions) => string;

function useTranslation(): {t: TFunc} {
  const t: TFunc = (_key, fallback) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    let result = fallback.defaultValue;
    for (const [token, value] of Object.entries(fallback)) {
      if (token === 'defaultValue') {
        continue;
      }
      result = result.split(`{{${token}}}`).join(String(value));
    }
    return result;
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

// ── Distance conversion (inlined verbatim from @/lib/unitConversion) ──────────
type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

/** Mirrors the web `useUnits` `deriveDistance`: imperial length ⇒ mi, else km. */
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
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

// ── Entrance animation (native parity of framer-motion initial/animate) ──────
// A timing tween drives an Animated.Value 0->1 after `delay` seconds over
// `duration` seconds; consumers interpolate opacity / translateX / scale from it.
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

// ── Stat row (parity of the per-stat motion.div) ─────────────────────────────
// Web: initial {x:-20, opacity:0} -> animate {x:0, opacity:1}, delay 0.3 + i·0.1,
// dur 0.4. Reproduced per-row so the list slides in one stat at a time.
interface StatRowProps {
  glyph: string;
  label: string;
  value: number;
  decimals: number;
  index: number;
  reduce: boolean;
}

function StatRow({glyph, label, value, decimals, index, reduce}: StatRowProps) {
  const entrance = useTimingEntrance(0.3 + index * 0.1, 0.4, reduce);

  return (
    <Animated.View
      style={[
        styles.statRow,
        {
          opacity: entrance,
          transform: [
            {
              translateX: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [-20, 0],
              }),
            },
          ],
        },
      ]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.statGlyph}>
        {glyph}
      </AppText>
      <AnimatedNumber
        value={value}
        duration={1}
        decimals={decimals}
        style={styles.statValue}
      />
      <AppText style={styles.statLabel}>{label}</AppText>
    </Animated.View>
  );
}

interface Props {
  data: YearReview;
}

export function SummarySlide({data}: Props) {
  const {t} = useTranslation();
  const reduce = useReduceMotion();
  const {data: settings} = useSettings();
  const distanceUnit = deriveDistance(settings?.unit_of_length);

  const stats = [
    {
      glyph: '🚗',
      label: t('yearReview.totalDrives', 'Drives'),
      value: data.total_drives,
      decimals: 0,
    },
    {
      glyph: '🚗',
      label: distanceUnit,
      // backend `total_distance_km` is SI km; convert via meter floor.
      value: convertDistanceFromSI(data.total_distance_km * 1000, distanceUnit),
      decimals: 0,
    },
    {
      glyph: '⚡',
      label: t('yearReview.energyKwh', 'kWh'),
      value: data.total_energy_kwh,
      decimals: 0,
    },
    {
      glyph: '🔌',
      label: t('yearReview.charges', 'Charges'),
      value: data.total_charge_sessions,
      decimals: 0,
    },
    {
      glyph: '🍃',
      label: t('yearReview.co2KgSaved', 'kg CO₂ saved'),
      value: data.co2_offset_kg,
      decimals: 0,
    },
  ];

  // framer-motion entrances (delay/duration in seconds, matching the source).
  const card = useTimingEntrance(0, 0.6, reduce);
  const savings = useTimingEntrance(1, 0.4, reduce);
  const screenshot = useTimingEntrance(1.2, 0.4, reduce);

  return (
    <View style={styles.container}>
      {/* Screenshot-friendly 16:9 card */}
      <Animated.View
        style={[
          styles.card,
          {
            opacity: card,
            transform: [
              {
                scale: card.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.9, 1],
                }),
              },
            ],
          },
        ]}>
        <View style={styles.header}>
          <View>
            <AppText style={styles.year}>{data.year}</AppText>
            <AppText style={styles.subtitle}>
              {t('yearReview.title', 'Year in Review')}
            </AppText>
          </View>
          <View style={styles.headerRight}>
            <AppText style={styles.vehicleName}>
              {data.vehicle.display_name}
            </AppText>
            <AppText style={styles.vehicleModel}>{data.vehicle.model}</AppText>
          </View>
        </View>

        <View style={styles.stats}>
          {stats.map((stat, i) => (
            <StatRow
              key={stat.label}
              glyph={stat.glyph}
              label={stat.label}
              value={stat.value}
              decimals={stat.decimals}
              index={i}
              reduce={reduce}
            />
          ))}
        </View>

        {data.gas_savings > 0 && (
          <Animated.View style={[styles.savings, {opacity: savings}]}>
            <AppText style={styles.savingsText}>
              💰{' '}
              {t('yearReview.savedSummary', {
                amount: Math.round(data.gas_savings),
                defaultValue: 'Saved ${{amount}} vs. gas',
              })}
            </AppText>
          </Animated.View>
        )}

        <AppText style={styles.footer}>TeslaSync • Year in Review</AppText>
      </Animated.View>

      <Animated.View style={{opacity: screenshot}}>
        <AppText style={styles.screenshot}>
          {t('yearReview.screenshot', '📸 Screenshot to share your year!')}
        </AppText>
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
  card: {
    // bg-gradient-to-br from-white/[0.08] to-white/[0.02] flattened to its mid
    // point; backdrop-blur-md has no dependency-free RN analog and is omitted.
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.12)', // border-white/[0.12]
    borderRadius: 24, // rounded-3xl
    borderWidth: 1, // border
    maxWidth: 448, // max-w-md
    padding: 32, // p-8
    width: '100%', // w-full
    ...shadows.panel, // shadow-2xl
  },
  header: {
    alignItems: 'center', // items-center
    flexDirection: 'row', // flex
    justifyContent: 'space-between', // justify-between
    marginBottom: 24, // mb-6
  },
  headerRight: {
    alignItems: 'flex-end', // text-right
  },
  year: {
    color: '#ffffff', // text-white
    fontSize: 24, // text-2xl
    fontWeight: '700', // font-bold
    lineHeight: 32,
  },
  subtitle: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  vehicleName: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
    lineHeight: 20,
    textAlign: 'right',
  },
  vehicleModel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
    textAlign: 'right',
  },
  stats: {
    gap: 12, // space-y-3
  },
  statRow: {
    alignItems: 'center', // items-center
    flexDirection: 'row', // flex
    gap: 12, // gap-3
  },
  statGlyph: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 20, // h-5 w-5
    lineHeight: 24,
    textAlign: 'center',
    width: 20, // shrink-0 (fixed slot)
  },
  statValue: {
    color: '#ffffff', // text-white
    fontSize: 20, // text-xl
    fontWeight: '700', // font-bold
    lineHeight: 28,
    minWidth: 64, // min-w-[4rem]
    textAlign: 'left', // text-left
  },
  statLabel: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  savings: {
    alignItems: 'center', // text-center
    borderTopColor: 'rgba(255, 255, 255, 0.08)', // border-white/[0.08]
    borderTopWidth: 1, // border-t
    marginTop: 24, // mt-6
    paddingTop: 16, // pt-4
  },
  savingsText: {
    color: 'rgba(52, 211, 153, 0.8)', // text-emerald-400/80
    fontSize: 14, // text-sm
    lineHeight: 20,
    textAlign: 'center',
  },
  footer: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 10, // text-[10px]
    lineHeight: 14,
    marginTop: 16, // mt-4
    textAlign: 'center',
  },
  screenshot: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 14, // text-sm
    lineHeight: 20,
    marginTop: 24, // mt-6
    textAlign: 'center',
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
});
