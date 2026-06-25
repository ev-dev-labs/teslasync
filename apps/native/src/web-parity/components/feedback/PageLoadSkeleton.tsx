// Native parity port of web/src/components/feedback/PageLoadSkeleton.tsx.
//
// Layout-shaped Suspense fallback shown while a lazy-loaded route chunk is
// fetched. The web source rendered a `animate-pulse` <div> (role="status",
// aria-busy) containing a header bar (title + subtitle + action placeholders)
// and `panels` shared web <GlassPanel> blocks, each filled with
// `bg-[var(--surface-2)]` placeholder rectangles sized with Tailwind h-/w-
// utilities, so the real page mounts without reflow (keeping CLS low).
//
// This port reproduces the same layout and pulsing intent with React Native
// View/Animated primitives, the native <GlassPanel>, and the design tokens --
// no DOM, no Tailwind, no recharts/leaflet, and no web UI components. The
// Tailwind `animate-pulse` opacity keyframe is recreated with a reduced-motion-
// aware Animated.loop opacity pulse (mirroring AIThinkingIndicator's native
// pulse). The `--surface-2` CSS variable that filled every placeholder has no
// token, so its dark-theme value (#151621) is recreated here. The narrow native
// viewport follows each web class's base (mobile) layout -- the `sm:` row/grid
// breakpoints stay collapsed -- documented in the sidecar.

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

import {GlassPanel} from '../../../components/ui/GlassPanel';

// The web placeholders were filled with `bg-[var(--surface-2)]`. The shared
// native token set has no equivalent surface step, so the CSS variable's
// dark-theme value (web/src/index.css `--surface-2: #151621`) is recreated here.
// Native is dark-only, so the light-theme override (#ffffff) is not ported.
const SURFACE_2 = '#151621';

// Tailwind `rounded` == border-radius 0.25rem (4px), used by every placeholder.
const BLOCK_RADIUS = 4;

// Tailwind `animate-pulse` is a 2s ease-in-out opacity keyframe
// (0%/100% opacity 1, 50% opacity .5). Recreated below as a two-leg loop.
const PULSE_DURATION_MS = 2000;
const PULSE_MIN_OPACITY = 0.5;

export interface PageLoadSkeletonProps {
  /** How many GlassPanel-shaped skeleton blocks to render below the header. Defaults to 3. */
  panels?: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the skeleton container (parity for `className`). */
  style?: StyleProp<ViewStyle>;
  /** Test hook (defaults to the web `data-testid`). */
  testID?: string;
}

/**
 * Mirror of web/src/components/ai (AIThinkingIndicator) reduce-motion probe:
 * resolves the OS "reduce motion" accessibility setting and keeps it live so
 * the pulse can be disabled for motion-sensitive users.
 */
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

/**
 * Native recreation of the Tailwind `animate-pulse` opacity keyframe applied to
 * the outer web <div>. Returns an Animated.Value driving the whole skeleton's
 * opacity between 1 and {@link PULSE_MIN_OPACITY}; when reduced motion is on it
 * stays solid (the static value 0), matching the web behaviour under
 * `prefers-reduced-motion` where the animation is suppressed.
 */
function usePulse(reduceMotion: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS / 2,
          easing: Easing.bezier(0.4, 0, 0.6, 1),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS / 2,
          easing: Easing.bezier(0.4, 0, 0.6, 1),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  return pulse;
}

/** A single `bg-[var(--surface-2)] rounded` placeholder rectangle. */
function SkeletonBlock({style}: {style?: StyleProp<ViewStyle>}): React.ReactElement {
  return <View style={[styles.block, style]} />;
}

/**
 * Layout-shaped Suspense fallback used while a lazy-loaded route chunk is being
 * fetched. Mirrors the typical PageContainer layout (heading bar + a few panels)
 * so the UI doesn't reflow when the real page mounts, keeping CLS low while
 * route chunks stream in.
 */
export function PageLoadSkeleton({
  panels = 3,
  className: _className,
  style,
  testID = 'page-load-skeleton',
}: PageLoadSkeletonProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const pulse = usePulse(reduceMotion);

  const animatedOpacity = reduceMotion
    ? undefined
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [1, PULSE_MIN_OPACITY],
        }),
      };

  return (
    <Animated.View
      accessibilityLabel="Loading page"
      accessibilityLiveRegion="polite"
      accessibilityState={{busy: true}}
      accessible
      style={[styles.container, animatedOpacity, style]}
      testID={testID}>
      {/* Header bar -- matches PageContainer title + subtitle */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <SkeletonBlock style={styles.titleBlock} />
          <SkeletonBlock style={styles.subtitleBlock} />
        </View>
        <SkeletonBlock style={styles.actionBlock} />
      </View>

      {/* Body panels */}
      {Array.from({length: panels}).map((_, i) => (
        <GlassPanel key={i} style={styles.panel}>
          <View style={styles.panelInner}>
            <SkeletonBlock style={styles.panelTitleBlock} />
            <View style={styles.metricsGrid}>
              <SkeletonBlock style={styles.metricBlock} />
              <SkeletonBlock style={styles.metricBlock} />
              <SkeletonBlock style={styles.metricBlock} />
            </View>
            <SkeletonBlock style={styles.bigBlock} />
          </View>
        </GlassPanel>
      ))}
    </Animated.View>
  );
}

PageLoadSkeleton.displayName = 'PageLoadSkeleton';

const styles = StyleSheet.create({
  // space-y-6
  container: {
    gap: 24,
  },
  // flex flex-col ... gap-3 (sm:flex-row stays collapsed on the narrow native viewport)
  header: {
    flexDirection: 'column',
    gap: 12,
  },
  // min-w-0 space-y-2
  headerText: {
    gap: 8,
    minWidth: 0,
  },
  block: {
    backgroundColor: SURFACE_2,
    borderRadius: BLOCK_RADIUS,
  },
  // h-7 w-48
  titleBlock: {
    height: 28,
    width: 192,
  },
  // h-3 w-72
  subtitleBlock: {
    height: 12,
    width: 288,
    maxWidth: '100%',
  },
  // h-9 w-32
  actionBlock: {
    height: 36,
    width: 128,
  },
  // GlassPanel p-6
  panel: {
    padding: 24,
  },
  // space-y-4
  panelInner: {
    gap: 16,
  },
  // h-5 w-40
  panelTitleBlock: {
    height: 20,
    width: 160,
    maxWidth: '100%',
  },
  // grid grid-cols-1 gap-3 (sm:grid-cols-3 stays collapsed on the narrow native viewport)
  metricsGrid: {
    flexDirection: 'column',
    gap: 12,
  },
  // h-20
  metricBlock: {
    height: 80,
  },
  // h-32
  bigBlock: {
    height: 128,
  },
});
