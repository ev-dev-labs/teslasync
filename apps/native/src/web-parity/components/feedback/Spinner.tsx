// Native parity port of web/src/components/feedback/Spinner.tsx.
//
// The web Spinner is the brand loading mark: a lightning bolt that draws itself
// like a strike, fills to solid, holds, then fades and redraws (CSS
// `boltDraw 2s ease-in-out infinite` on `.spinner-bolt-draw`). Its cyan/emerald
// electrical glow comes from a CSS `drop-shadow` stack (`.spinner-bolt-glow`,
// `--theme-primary #22d3ee` + `--theme-accent #10b981`). It honours
// `prefers-reduced-motion`: when reduced motion is requested the bolt renders
// fully filled with the same glow and no draw cycle.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - There is no react-native-svg in this app, so the SVG `<path>` lightning
//     bolt becomes the high-voltage glyph (⚡) rendered in an Animated.Text —
//     the same glyph-marker precedent used by the ErrorBoundary parity port.
//     The bolt fill stays white (text-white -> colors.textPrimary) and the
//     two-layer cyan+emerald drop-shadow glow collapses to a single cyan
//     textShadow (RN Text exposes one shadow), tracking the app accent.
//   - The SVG pathLength/strokeDasharray "draw -> fill -> hold -> fade ->
//     redraw" cadence has no stroke-dash analogue without SVG, so it is
//     approximated by a 2s looping opacity (with a subtle scale) pulse on a
//     single native-driver value — same period, same draw/hold/fade shape.
//   - `useMotionPreference()` (framer-motion) becomes a native useReduceMotion()
//     backed by AccessibilityInfo; `reduce` keeps identical meaning — static
//     fully-filled bolt, no loop.
//   - `cn(...)` + the `className` prop become a `style` passthrough merged onto
//     the root container (gap-3 -> spacing.md, flex-col + items-center).
//   - `role="status"` + `aria-label` map to an accessible progressbar node with
//     a polite live region and the same default "Loading" label; the SVG
//     `aria-hidden="true"` maps to accessibilityElementsHidden on the bolt.

import React, {useEffect, useRef} from 'react';
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

type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  label?: string;
  /**
   * Native equivalent of the web `className` passthrough: extra styles merged
   * onto the root container so callers can position/space the loader.
   */
  style?: StyleProp<ViewStyle>;
}

// Mirrors the web sizeMap. `box`/`pixels` drive the bolt container + glyph size;
// `stroke` was the SVG bolt line thickness — there is no per-glyph stroke width,
// so the bolt always renders bold (see styles.bolt) and `stroke` is retained
// here only to document the 1:1 size mapping it came from.
const sizeMap: Record<SpinnerSize, {pixels: number; stroke: number}> = {
  sm: {pixels: 24, stroke: 22},
  md: {pixels: 48, stroke: 14},
  lg: {pixels: 80, stroke: 10},
};

const boxStyles: Record<SpinnerSize, ViewStyle> = {
  sm: {height: 24, width: 24},
  md: {height: 48, width: 48},
  lg: {height: 80, width: 80},
};

const boltSizeStyles = {
  sm: {fontSize: 24, lineHeight: 24},
  md: {fontSize: 48, lineHeight: 48},
  lg: {fontSize: 80, lineHeight: 80},
} as const;

// Full draw -> hold -> fade -> redraw cycle, matching the web `boltDraw 2s`.
const DRAW_MS = 520;
const HOLD_MS = 760;
const FADE_MS = 520;
const REDRAW_GAP_MS = 200;

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = React.useState(false);

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

function BoltMark({
  size,
  reduceMotion,
}: {
  size: SpinnerSize;
  reduceMotion: boolean;
}): React.ReactElement {
  // 1 = bolt fully drawn/filled, 0 = empty (pre-draw / post-fade). When reduced
  // motion is requested the bolt holds at 1 (solid) with no loop, exactly like
  // the web `fillOpacity={1}` / no `.spinner-bolt-draw` branch.
  const draw = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      draw.setValue(1);
      return;
    }

    draw.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(draw, {
          duration: DRAW_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.delay(HOLD_MS),
        Animated.timing(draw, {
          duration: FADE_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.delay(REDRAW_GAP_MS),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [draw, reduceMotion]);

  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: draw,
        transform: [
          {
            scale: draw.interpolate({
              inputRange: [0, 1],
              outputRange: [0.94, 1],
            }),
          },
        ],
      };

  return (
    <Animated.Text
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.bolt, boltSizeStyles[size], animatedStyle]}>
      {'\u26A1'}
    </Animated.Text>
  );
}

/**
 * Brand loading mark — a lightning bolt that pulses (draw -> fill -> hold ->
 * fade -> redraw) with a cyan electrical glow. Honours reduced motion by
 * rendering the bolt fully filled with no animation.
 */
export function Spinner({size = 'md', label, style}: SpinnerProps): React.ReactElement {
  const reduceMotion = useReduceMotion();

  return (
    <View
      accessibilityLabel={label ?? 'Loading'}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessible
      style={[styles.root, style]}
      testID="spinner">
      <View style={[styles.box, boxStyles[size]]}>
        <BoltMark reduceMotion={reduceMotion} size={size} />
      </View>
      {label ? <AppText style={styles.label}>{label}</AppText> : null}
    </View>
  );
}

Spinner.displayName = 'Spinner';

// Exposed so callers/tests can reference the web sizeMap parity without
// re-deriving the pixel/stroke pairs.
export const spinnerSizeMap = sizeMap;

const styles = StyleSheet.create({
  bolt: {
    color: colors.textPrimary,
    textAlign: 'center',
    textShadowColor: colors.accent,
    textShadowOffset: {height: 0, width: 0},
    textShadowRadius: 12,
  },
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'column',
    gap: spacing.md,
  },
});
