// Native parity port of web/src/components/ai/AIThinkingIndicator.tsx.
//
// Replaces DOM spans/divs, Tailwind motion classes, and the web HelixMark with
// React Native primitives, native tokens, and reduced-motion-aware animations.

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

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

type NativeTFunction = (key: string, fallback: string) => string;

export interface AIThinkingIndicatorProps {
  /**
   * Optional override for the leading label (default
   * `t('helix.thinking', 'Helix is thinking')`). Pass a translated
   * string when the surrounding feature wants a domain-specific verb.
   */
  label?: string;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
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

function useLoopingPulse(
  reduceMotion: boolean,
  delayMs: number,
  durationMs: number,
): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(pulse, {
          duration: durationMs / 2,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: durationMs / 2,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, durationMs, pulse, reduceMotion]);

  return pulse;
}

function NativeHelixMark({
  reduceMotion,
}: {
  reduceMotion: boolean;
}): React.ReactElement {
  const pulse = useLoopingPulse(reduceMotion, 0, 1400);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.72, 1],
        }),
      };

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.helixMark, animatedStyle]}>
      <View style={[styles.helixStrand, styles.helixStrandForward]} />
      <View style={[styles.helixStrand, styles.helixStrandBackward]} />
      <View style={[styles.helixRung, styles.helixRungTop]} />
      <View style={[styles.helixRung, styles.helixRungBottom]} />
    </Animated.View>
  );
}

function ThinkingDot({
  color,
  delayMs,
  reduceMotion,
}: {
  color: string;
  delayMs: number;
  reduceMotion: boolean;
}): React.ReactElement {
  const pulse = useLoopingPulse(reduceMotion, delayMs, 720);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.72, 1],
        }),
        transform: [
          {
            translateY: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -3],
            }),
          },
        ],
      };

  return (
    <Animated.View
      style={[styles.thinkingDot, {backgroundColor: color}, animatedStyle]}
    />
  );
}

function SkeletonLine({
  delayMs,
  reduceMotion,
  widthStyle,
}: {
  delayMs: number;
  reduceMotion: boolean;
  widthStyle: StyleProp<ViewStyle>;
}): React.ReactElement {
  const pulse = useLoopingPulse(reduceMotion, delayMs, 1200);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.52, 0.95],
        }),
      };

  return (
    <Animated.View style={[styles.skeletonLine, widthStyle, animatedStyle]} />
  );
}

/**
 * AIThinkingIndicator is the streaming-but-empty state shown while waiting for
 * the first model token. It preserves the web label, Helix mark, three thinking
 * dots, and decreasing skeleton prose lines with native-safe reduced motion.
 */
export function AIThinkingIndicator({
  label,
}: AIThinkingIndicatorProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();
  const text = label ?? t('helix.thinking', 'Helix is thinking');

  return (
    <View
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessible
      style={styles.root}
      testID="ai-thinking-indicator">
      <View style={styles.labelRow}>
        <NativeHelixMark reduceMotion={reduceMotion} />
        <AppText style={styles.labelText} weight="semibold">
          {text}
        </AppText>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.dotRow}>
          <ThinkingDot color={colors.accent} delayMs={0} reduceMotion={reduceMotion} />
          <ThinkingDot
            color={colors.accent}
            delayMs={120}
            reduceMotion={reduceMotion}
          />
          <ThinkingDot
            color={colors.accent}
            delayMs={240}
            reduceMotion={reduceMotion}
          />
        </View>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.skeletonGroup}>
        <SkeletonLine
          delayMs={0}
          reduceMotion={reduceMotion}
          widthStyle={styles.skeletonLineFull}
        />
        <SkeletonLine
          delayMs={300}
          reduceMotion={reduceMotion}
          widthStyle={styles.skeletonLineShort}
        />
        <SkeletonLine
          delayMs={600}
          reduceMotion={reduceMotion}
          widthStyle={styles.skeletonLineShortest}
        />
      </View>
    </View>
  );
}
AIThinkingIndicator.displayName = 'AIThinkingIndicator';

/**
 * AIThinkingDots is the compact in-button thinking indicator: label plus three
 * small dots. It keeps the web shape without DOM span/currentColor usage.
 */
export function AIThinkingDots({label}: {label: string}): React.ReactElement {
  const reduceMotion = useReduceMotion();

  return (
    <View style={styles.compactRoot}>
      <AppText style={styles.compactLabel} weight="semibold">
        {label}
      </AppText>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.compactDotRow}>
        <ThinkingDot
          color={colors.textPrimary}
          delayMs={0}
          reduceMotion={reduceMotion}
        />
        <ThinkingDot
          color={colors.textPrimary}
          delayMs={120}
          reduceMotion={reduceMotion}
        />
        <ThinkingDot
          color={colors.textPrimary}
          delayMs={240}
          reduceMotion={reduceMotion}
        />
      </View>
    </View>
  );
}
AIThinkingDots.displayName = 'AIThinkingDots';

const styles = StyleSheet.create({
  compactDotRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 3,
  },
  compactLabel: {
    color: colors.textPrimary,
    lineHeight: 18,
  },
  compactRoot: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dotRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 4,
  },
  helixMark: {
    height: 16,
    position: 'relative',
    width: 16,
  },
  helixRung: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 1.5,
    left: 4.5,
    opacity: 0.86,
    position: 'absolute',
    width: 7,
  },
  helixRungBottom: {
    bottom: 4.5,
  },
  helixRungTop: {
    top: 4.5,
  },
  helixStrand: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 17,
    left: 7,
    position: 'absolute',
    top: -0.5,
    width: 2,
  },
  helixStrandBackward: {
    transform: [{rotate: '32deg'}],
  },
  helixStrandForward: {
    transform: [{rotate: '-32deg'}],
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  labelText: {
    color: colors.accent,
    lineHeight: 20,
  },
  root: {
    gap: spacing.md,
  },
  skeletonGroup: {
    gap: spacing.sm,
  },
  skeletonLine: {
    backgroundColor: 'rgba(53, 213, 255, 0.16)',
    borderRadius: 8,
    height: 12,
  },
  skeletonLineFull: {
    width: '100%',
  },
  skeletonLineShort: {
    width: '92%',
  },
  skeletonLineShortest: {
    width: '75%',
  },
  thinkingDot: {
    borderRadius: 999,
    height: 4,
    width: 4,
  },
});
