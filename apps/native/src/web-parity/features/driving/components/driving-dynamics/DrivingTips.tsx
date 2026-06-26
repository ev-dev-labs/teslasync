// Native parity port of
// web/src/features/driving/components/driving-dynamics/DrivingTips.tsx.
//
// The web component renders a glass panel (inside a `FadeIn` delayed 0.6s) with a
// Lightbulb-iconed "Driving Style Recommendations" heading, then a vertical list
// of recommendation rows. Each row carries a leading status icon — a green
// ShieldCheck when the throttle style is 'conservative', otherwise a yellow
// AlertTriangle — beside the recommendation text. The tip list itself is derived
// with `useMemo` from `motorStats` (null -> single "no data" tip; avgPower>80 ->
// ease-accel + brake-early; >20 -> smooth-throttle + coast; else -> great + keep;
// plus a thermal tip when maxMotorTemp>120).
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next useTranslation -> useNativeTranslation() shim returning the
//     fallback copy verbatim; every web t() key + default string is preserved.
//   - lucide-react Lightbulb/ShieldCheck/AlertTriangle -> decorative Unicode
//     glyphs in an AppText with importantForAccessibility="no" (the same
//     conversion the ClimateStatusWidget/ActionItem ports use for lucide icons;
//     lucide is a DOM/SVG icon lib). The web text-yellow-400/text-green-400
//     colours are reproduced as static StyleSheet colours (#facc15 / #4ade80) and
//     the h-5 (20px) / h-4 (16px) sizes become fontSize 20 / 16.
//   - `@/components/ui` GlassPanel -> the native parity components/ui/GlassPanel;
//     the web `className="p-6"` padding becomes RN style padding 24.
//   - `@/components/motion` FadeIn (framer-motion, browser-only) -> an inline
//     native Animated FadeIn (opacity 0->1 + slide-up 12->0, reduce-motion-aware
//     via AccessibilityInfo) honouring the web `delay={0.6}` (seconds -> ms).
//   - `@/lib/cn` cn() -> dropped; the two merged Tailwind class strings become a
//     single static RN style object (rounded-lg row with translucent bg+border).
//   - `./helpers` MotorStats + ThrottleStyle types -> inlined local copies (same
//     shapes) so the props contract is preserved without a DOM-coupled import.

import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
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

/* ─── inline shims ─────────────────────────────────────────────────────────── */

// react-i18next useTranslation(): t(key, fallback) returns the fallback copy.
function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

// lucide-react icons have no native icon dependency; per the ClimateStatusWidget /
// ActionItem precedent each becomes a decorative Unicode glyph.
const ICON_LIGHTBULB = '\u{1F4A1}'; // lucide Lightbulb
const ICON_SHIELD_CHECK = '\u2714'; // lucide ShieldCheck (conservative -> safe)
const ICON_ALERT_TRIANGLE = '\u26A0'; // lucide AlertTriangle

// Web `FadeIn` default entrance duration (useMotionPreference(400)).
const FADE_DURATION_MS = 400;

// Mirrors the StatCard / TemperatureGauges reduce-motion source-of-truth.
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

// Native parity for `@/components/motion` FadeIn: fades + slides children up on
// mount after `delay` seconds. Reduce-motion renders the final state immediately.
function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
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
      delay: delay * 1000,
      duration: FADE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [delay, progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

/* ─── inlined types (web `./helpers`) ──────────────────────────────────────── */

type ThrottleStyle = 'conservative' | 'moderate' | 'aggressive';

interface MotorStats {
  totalReadings: number;
  avgTorque: number;
  maxTorque: number;
  avgMotorTemp: number;
  maxMotorTemp: number;
  avgPower: number;
  peakPower: number;
  minPower: number;
  peakRegen: number;
  highTorquePct: number;
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface DrivingTipsProps {
  motorStats: MotorStats | null;
  throttleStyle: ThrottleStyle | null;
}

export default function DrivingTips({motorStats, throttleStyle}: DrivingTipsProps) {
  const t = useNativeTranslation();

  const tips = useMemo(() => {
    const list: string[] = [];
    if (!motorStats) {
      list.push(t('dynamics.tipNoData', 'Drive your vehicle to start collecting dynamics data.'));
      return list;
    }
    if (motorStats.avgPower > 80) {
      list.push(t('dynamics.tipEaseAccel', 'Ease into the accelerator — gradual inputs save energy and tire wear.'));
      list.push(t('dynamics.tipBrakeEarly', 'Brake earlier and lighter to improve regen capture.'));
    } else if (motorStats.avgPower > 20) {
      list.push(t('dynamics.tipSmoothThrottle', 'Smooth throttle transitions can improve efficiency by 10–15%.'));
      list.push(t('dynamics.tipCoast', 'Lift off the pedal earlier to let regen do the work.'));
    } else {
      list.push(t('dynamics.tipGreat', 'Excellent driving style! Maintaining this maximizes range and comfort.'));
      list.push(t('dynamics.tipKeep', 'Keep monitoring your scores — consistency is key.'));
    }
    if (motorStats.maxMotorTemp > 120) {
      list.push(t('dynamics.tipThermal', 'Motor temps are running high — consider easing off sustained high power.'));
    }
    return list;
  }, [motorStats, t]);

  return (
    <FadeIn delay={0.6}>
      <GlassPanel style={styles.panel}>
        <View style={styles.headingRow}>
          <AppText
            allowFontScaling={false}
            importantForAccessibility="no"
            style={styles.headingIcon}>
            {ICON_LIGHTBULB}
          </AppText>
          <AppText accessibilityRole="header" style={styles.heading}>
            {t('dynamics.recommendations', 'Driving Style Recommendations')}
          </AppText>
        </View>
        <View style={styles.tipList}>
          {tips.map((tip, i) => (
            <View key={i} style={styles.tipRow}>
              <AppText
                allowFontScaling={false}
                importantForAccessibility="no"
                style={
                  throttleStyle === 'conservative'
                    ? styles.tipIconConservative
                    : styles.tipIconAggressive
                }>
                {throttleStyle === 'conservative'
                  ? ICON_SHIELD_CHECK
                  : ICON_ALERT_TRIANGLE}
              </AppText>
              <AppText style={styles.tipText} tone="secondary">
                {tip}
              </AppText>
            </View>
          ))}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: 18,
    fontWeight: '600',
  },
  headingIcon: {
    color: '#facc15',
    fontSize: 20,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: 16,
  },
  panel: {
    padding: 24,
  },
  tipIconAggressive: {
    color: '#facc15',
    flexShrink: 0,
    fontSize: 16,
    marginTop: 2,
  },
  tipIconConservative: {
    color: '#4ade80',
    flexShrink: 0,
    fontSize: 16,
    marginTop: 2,
  },
  tipList: {
    gap: spacing.md,
  },
  tipRow: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
  },
});
