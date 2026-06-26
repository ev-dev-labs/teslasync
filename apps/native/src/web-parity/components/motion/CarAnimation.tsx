// Native parity port of web/src/components/motion/CarAnimation.tsx.
//
// The web source is built entirely from framer-motion `motion.*` SVG primitives
// (path/circle/ellipse/rect/g) plus a `div` wrapper. React Native has no built-in
// SVG path/circle renderer in this app, so each illustration is approximated with
// positioned `View` strokes/fills (the same technique used by the HelixMark,
// RadialGauge, and Sparkline parity ports). framer-motion transitions become
// `Animated` timings/springs/loops, `prefers-reduced-motion` becomes
// `AccessibilityInfo.isReduceMotionEnabled`, and `useTranslation` becomes a
// fallback shim that returns the English default (matching the other native ports).
//
// Resolved colours mirror the web CSS custom properties from web/src/index.css
// (dark theme) and the COLOR semantic constants from web/src/lib/colors.ts so the
// visual intent is preserved without depending on browser CSS variables.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// --- Resolved design tokens (web CSS vars -> dark-theme hex / rgba) ---
const SURFACE_1 = '#0f1019'; // var(--surface-1)
const SURFACE_2 = '#151621'; // var(--surface-2)
const SURFACE_3 = '#1a1b2e'; // var(--surface-3)
const TEXT_MUTED = '#8a95a6'; // var(--text-muted)
const THEME_PRIMARY = '#00f0ff'; // var(--theme-primary)
const WINDSHIELD_FILL = 'rgba(0, 240, 255, 0.15)';
const WINDSHIELD_STROKE = 'rgba(0, 240, 255, 0.5)';
const REAR_WINDOW_FILL = 'rgba(0, 240, 255, 0.1)';
const REAR_WINDOW_STROKE = 'rgba(0, 240, 255, 0.3)';
const TAILLIGHT = '#ef4444';
const GROUND_SHADOW = 'rgba(138, 149, 166, 0.15)';
const BATTERY_CAP_FILL = 'rgba(138, 149, 166, 0.4)';

// COLOR.* semantic constants from web/src/lib/colors.ts.
const COLOR_GOOD = '#10b981';
const COLOR_WARN = '#f59e0b';
const COLOR_BAD = '#ef4444';

type NativeTFunction = (key: string, fallback: string) => string;

interface IllustrationProps {
  size?: number;
  /** Web-only className; accepted for source API parity but ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface BatteryFillAnimationProps extends IllustrationProps {
  level?: number;
}

// --- Reduced-motion + i18n shims (shared across the four illustrations) ---

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduce(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduce,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduce;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// --- Animation primitives mapping framer-motion transitions to Animated ---

/** Eases a value 0 -> 1 once, after an optional one-time delay. */
function useTimedTo1(
  reduce: boolean,
  delayMs: number,
  durationMs: number,
  easing: (value: number) => number = Easing.inOut(Easing.ease),
  useNative = true,
): Animated.Value {
  const value = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      value.setValue(1);
      return;
    }

    value.setValue(0);
    const animation = Animated.sequence([
      Animated.delay(delayMs),
      Animated.timing(value, {
        duration: durationMs,
        easing,
        toValue: 1,
        useNativeDriver: useNative,
      }),
    ]);

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, durationMs, easing, reduce, useNative, value]);

  return value;
}

/** Springs a value 0 -> 1 once, after an optional one-time delay. */
function useSpringTo1(reduce: boolean, delayMs: number): Animated.Value {
  const value = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      value.setValue(1);
      return;
    }

    value.setValue(0);
    const animation = Animated.sequence([
      Animated.delay(delayMs),
      Animated.spring(value, {
        friction: 6,
        tension: 90,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, reduce, value]);

  return value;
}

/**
 * Linear 0 -> 1 sawtooth driver that loops forever (after an optional one-time
 * delay). Callers interpolate it into the framer-motion keyframe arrays. Pinned
 * to 0 when reduced motion is requested so callers can fall back to a steady
 * final value.
 */
function usePulseLoop(
  reduce: boolean,
  delayMs: number,
  durationMs: number,
): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      value.setValue(0);
      return;
    }

    value.setValue(0);
    const animation = Animated.sequence([
      Animated.delay(delayMs),
      Animated.loop(
        Animated.timing(value, {
          duration: durationMs,
          easing: Easing.linear,
          toValue: 1,
          useNativeDriver: true,
        }),
      ),
    ]);

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, durationMs, reduce, value]);

  return value;
}

// --- CarAnimation (Tesla silhouette, viewBox 0 0 240 96) ---

function CarWheel({
  cx,
  scale,
  reduce,
  outerDelayMs,
  innerDelayMs,
}: {
  cx: number;
  scale: number;
  reduce: boolean;
  outerDelayMs: number;
  innerDelayMs: number;
}): React.ReactElement {
  const outerScale = useSpringTo1(reduce, outerDelayMs);
  const innerScale = useSpringTo1(reduce, innerDelayMs);
  const outerSize = 28 * scale;
  const innerSize = 12 * scale;

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.wheelOuter,
          {
            borderRadius: outerSize / 2,
            borderWidth: Math.max(1, 2 * scale),
            height: outerSize,
            left: (cx - 14) * scale,
            top: (70 - 14) * scale,
            transform: [{scale: outerScale}],
            width: outerSize,
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.wheelInner,
          {
            borderRadius: innerSize / 2,
            borderWidth: Math.max(1, scale),
            height: innerSize,
            left: (cx - 6) * scale,
            top: (70 - 6) * scale,
            transform: [{scale: innerScale}],
            width: innerSize,
          },
        ]}
      />
    </>
  );
}

/**
 * Animated Tesla silhouette for loading states and hero sections. Honors reduced
 * motion: when requested, every shape renders in its final state with no draw-in,
 * fade, spring, or pulsing head/tail-light loop.
 */
export function CarAnimation({
  size = 120,
  className: _className = '',
  style,
  testID,
}: IllustrationProps): React.ReactElement {
  const reduce = useReduceMotion();
  const t = useNativeTranslationFallback();
  const scale = size / 240;
  const stageHeight = size * 0.4;

  // Car body draw-in is approximated by a fade-in (no Animated pathLength on View).
  const bodyOpacity = useTimedTo1(reduce, 0, 1500);
  const windshieldOpacity = useTimedTo1(reduce, 800, 600);
  const rearWindowOpacity = useTimedTo1(reduce, 1000, 500);
  const shadowScaleX = useTimedTo1(reduce, 500, 800);
  const headlightDriver = usePulseLoop(reduce, 1200, 2000);
  const taillightDriver = usePulseLoop(reduce, 1400, 2000);

  const headlightStyle = reduce
    ? null
    : {
        opacity: headlightDriver.interpolate({
          inputRange: [0, 1 / 3, 2 / 3, 1],
          outputRange: [0, 0.8, 0.4, 0.8],
        }),
      };
  const taillightStyle = reduce
    ? null
    : {
        opacity: taillightDriver.interpolate({
          inputRange: [0, 1 / 3, 2 / 3, 1],
          outputRange: [0, 0.7, 0.3, 0.7],
        }),
      };

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t('carAnimation.tesla', 'Tesla vehicle illustration')}
      accessible
      style={[styles.root, style]}
      testID={testID}>
      <View pointerEvents="none" style={[styles.stage, {height: stageHeight, width: size}]}>
        <Animated.View
          style={[
            styles.shadow,
            {
              borderRadius: 4 * scale,
              height: 8 * scale,
              left: 40 * scale,
              top: 82 * scale,
              transform: [{scaleX: shadowScaleX}],
              width: 180 * scale,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.body,
            {
              borderBottomLeftRadius: 8 * scale,
              borderBottomRightRadius: 8 * scale,
              borderTopLeftRadius: 70 * scale,
              borderTopRightRadius: 70 * scale,
              borderWidth: Math.max(1, 1.5 * scale),
              height: 50 * scale,
              left: 30 * scale,
              opacity: bodyOpacity,
              top: 20 * scale,
              width: 200 * scale,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.rearWindow,
            {
              borderRadius: 5 * scale,
              borderWidth: Math.max(1, 0.6 * scale),
              height: 12 * scale,
              left: 56 * scale,
              opacity: rearWindowOpacity,
              top: 30 * scale,
              width: 30 * scale,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.windshield,
            {
              borderRadius: 9 * scale,
              borderWidth: Math.max(1, 0.8 * scale),
              height: 18 * scale,
              left: 88 * scale,
              opacity: windshieldOpacity,
              top: 24 * scale,
              width: 80 * scale,
            },
          ]}
        />
        <CarWheel
          cx={70}
          innerDelayMs={500}
          outerDelayMs={300}
          reduce={reduce}
          scale={scale}
        />
        <CarWheel
          cx={190}
          innerDelayMs={600}
          outerDelayMs={400}
          reduce={reduce}
          scale={scale}
        />
        <Animated.View
          style={[
            styles.headlight,
            {
              borderRadius: 4 * scale,
              height: 12 * scale,
              left: 224 * scale,
              top: 49 * scale,
              width: 8 * scale,
            },
            headlightStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.taillight,
            {
              borderRadius: 2 * scale,
              height: 12 * scale,
              left: 28 * scale,
              top: 50 * scale,
              width: 4 * scale,
            },
            taillightStyle,
          ]}
        />
      </View>
    </View>
  );
}
CarAnimation.displayName = 'CarAnimation';

// --- ChargingBolt (lightning glyph, viewBox 0 0 24 24) ---

/**
 * Animated charging bolt icon. The single SVG lightning path is approximated by
 * two accent strokes forming a zig-zag; its pulsing fillOpacity loop becomes a
 * gentle opacity pulse, and the entry fade/slide is preserved. Pulse is disabled
 * under reduced motion.
 */
export function ChargingBolt({
  size = 32,
  className: _className = '',
  style,
  testID,
}: IllustrationProps): React.ReactElement {
  const reduce = useReduceMotion();
  const t = useNativeTranslationFallback();
  const scale = size / 24;

  const entry = useTimedTo1(reduce, 0, 500);
  const pulseDriver = usePulseLoop(reduce, 0, 1500);

  const entryStyle = reduce
    ? null
    : {
        opacity: entry,
        transform: [
          {
            translateY: entry.interpolate({
              inputRange: [0, 1],
              outputRange: [-4, 0],
            }),
          },
        ],
      };
  const boltStyle = reduce
    ? null
    : {
        opacity: pulseDriver.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.6, 1, 0.6],
        }),
      };

  const barThickness = 3 * scale;

  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel={t('carAnimation.charging', 'Charging')}
      accessible
      style={[styles.boltStage, {height: size, width: size}, style, entryStyle]}
      testID={testID}>
      <Animated.View
        pointerEvents="none"
        style={[styles.boltGlyph, boltStyle]}>
        <View
          style={[
            styles.boltBar,
            {
              borderRadius: barThickness / 2,
              height: barThickness,
              left: 10.5 * scale - 6.1 * scale,
              top: 8 * scale - barThickness / 2,
              transform: [{rotateZ: '125deg'}],
              width: 12.2 * scale,
            },
          ]}
        />
        <View
          style={[
            styles.boltBar,
            {
              borderRadius: barThickness / 2,
              height: barThickness,
              left: 13 * scale - 6.4 * scale,
              top: 16 * scale - barThickness / 2,
              transform: [{rotateZ: '51deg'}],
              width: 12.8 * scale,
            },
          ]}
        />
      </Animated.View>
    </Animated.View>
  );
}
ChargingBolt.displayName = 'ChargingBolt';

// --- BatteryFillAnimation (gauge, viewBox 0 0 48 24) ---

/**
 * Animated battery fill gauge. The fill grows from empty to its target width and
 * respects reduced motion by jumping straight to the final width. Width math is
 * preserved verbatim from the web source so fill proportions match.
 */
export function BatteryFillAnimation({
  level = 80,
  size = 48,
  className: _className = '',
  style,
  testID,
}: BatteryFillAnimationProps): React.ReactElement {
  const reduce = useReduceMotion();
  const scale = size / 48;

  const barWidth = size * 0.6;
  const fillWidth = ((barWidth - 4) * Math.min(level, 100)) / 100;
  const color = level >= 60 ? COLOR_GOOD : level >= 30 ? COLOR_WARN : COLOR_BAD;
  // Viewbox-space fill width, kept identical to the web `width` expression.
  const fillWidthVb = fillWidth * (38 / (48 * 0.6 - 4));
  const targetFillPx = fillWidthVb * scale;

  const svgOpacity = useTimedTo1(reduce, 0, 400);
  const fillProgress = useTimedTo1(
    reduce,
    300,
    1200,
    Easing.out(Easing.ease),
    false,
  );
  const animatedFillWidth = fillProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, targetFillPx],
  });

  return (
    <Animated.View
      accessibilityRole="image"
      accessible
      style={[
        styles.batteryStage,
        {height: size * 0.5, opacity: svgOpacity, width: size},
        style,
      ]}
      testID={testID}>
      <View
        pointerEvents="none"
        style={[
          styles.batteryOutline,
          {
            borderRadius: 3 * scale,
            borderWidth: Math.max(1, 1.5 * scale),
            height: 16 * scale,
            left: 2 * scale,
            top: 4 * scale,
            width: 38 * scale,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.batteryCap,
          {
            borderRadius: scale,
            height: 8 * scale,
            left: 40 * scale,
            top: 8 * scale,
            width: 4 * scale,
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.batteryFill,
          {
            backgroundColor: color,
            borderRadius: 1.5 * scale,
            height: 12 * scale,
            left: 4 * scale,
            top: 6 * scale,
            width: animatedFillWidth,
          },
        ]}
      />
    </Animated.View>
  );
}
BatteryFillAnimation.displayName = 'BatteryFillAnimation';

// --- WheelSpin (spinning wheel, viewBox 0 0 24 24) ---

const WHEEL_SPOKE_ANGLES = [0, 72, 144, 216, 288];

/**
 * Spinning wheel for drive-related loading states. The continuous spin becomes a
 * static wheel under reduced motion. Five spokes are placed by trigonometry to
 * mirror the SVG `rotate(angle 12 12)` ticks.
 */
export function WheelSpin({
  size = 24,
  className: _className = '',
  style,
  testID,
}: IllustrationProps): React.ReactElement {
  const reduce = useReduceMotion();
  const t = useNativeTranslationFallback();
  const scale = size / 24;

  const spinDriver = usePulseLoop(reduce, 0, 2000);
  const rotate = spinDriver.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const outerSize = 20 * scale;
  const innerSize = 8 * scale;
  const spokeThickness = 1.5 * scale;
  const spokeLength = 3 * scale;
  const spokeRadius = 5.5 * scale;
  const center = 12 * scale;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t('carAnimation.loading', 'Loading')}
      accessible
      style={[styles.wheelSpinStage, {height: size, width: size}, style]}
      testID={testID}>
      <View
        pointerEvents="none"
        style={[
          styles.wheelSpinOuter,
          {
            borderRadius: outerSize / 2,
            borderWidth: Math.max(1, 1.5 * scale),
            height: outerSize,
            left: 2 * scale,
            top: 2 * scale,
            width: outerSize,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.wheelSpinInner,
          {
            borderRadius: innerSize / 2,
            borderWidth: Math.max(1, scale),
            height: innerSize,
            left: 8 * scale,
            top: 8 * scale,
            width: innerSize,
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.spinner,
          {height: size, transform: [{rotateZ: rotate}], width: size},
        ]}>
        {WHEEL_SPOKE_ANGLES.map(angle => {
          const radians = (angle * Math.PI) / 180;
          const cx = center + spokeRadius * Math.sin(radians);
          const cy = center - spokeRadius * Math.cos(radians);

          return (
            <View
              key={angle}
              style={[
                styles.spoke,
                {
                  borderRadius: spokeThickness / 2,
                  height: spokeLength,
                  left: cx - spokeThickness / 2,
                  top: cy - spokeLength / 2,
                  transform: [{rotateZ: `${angle}deg`}],
                  width: spokeThickness,
                },
              ]}
            />
          );
        })}
      </Animated.View>
    </View>
  );
}
WheelSpin.displayName = 'WheelSpin';

const styles = StyleSheet.create({
  batteryCap: {
    backgroundColor: BATTERY_CAP_FILL,
    position: 'absolute',
  },
  batteryFill: {
    position: 'absolute',
  },
  batteryOutline: {
    borderColor: TEXT_MUTED,
    position: 'absolute',
  },
  batteryStage: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  body: {
    backgroundColor: SURFACE_2,
    borderColor: THEME_PRIMARY,
    position: 'absolute',
  },
  boltBar: {
    backgroundColor: THEME_PRIMARY,
    position: 'absolute',
  },
  boltGlyph: {
    height: '100%',
    position: 'relative',
    width: '100%',
  },
  boltStage: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  headlight: {
    backgroundColor: THEME_PRIMARY,
    position: 'absolute',
  },
  rearWindow: {
    backgroundColor: REAR_WINDOW_FILL,
    borderColor: REAR_WINDOW_STROKE,
    position: 'absolute',
  },
  root: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  shadow: {
    backgroundColor: GROUND_SHADOW,
    position: 'absolute',
  },
  spinner: {
    left: 0,
    position: 'absolute',
    top: 0,
  },
  spoke: {
    backgroundColor: TEXT_MUTED,
    position: 'absolute',
  },
  stage: {
    position: 'relative',
  },
  taillight: {
    backgroundColor: TAILLIGHT,
    position: 'absolute',
  },
  wheelInner: {
    backgroundColor: SURFACE_1,
    borderColor: TEXT_MUTED,
    position: 'absolute',
  },
  wheelOuter: {
    backgroundColor: SURFACE_3,
    borderColor: TEXT_MUTED,
    position: 'absolute',
  },
  wheelSpinInner: {
    backgroundColor: SURFACE_1,
    borderColor: TEXT_MUTED,
    position: 'absolute',
  },
  wheelSpinOuter: {
    backgroundColor: SURFACE_3,
    borderColor: TEXT_MUTED,
    position: 'absolute',
  },
  wheelSpinStage: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  windshield: {
    backgroundColor: WINDSHIELD_FILL,
    borderColor: WINDSHIELD_STROKE,
    position: 'absolute',
  },
});
