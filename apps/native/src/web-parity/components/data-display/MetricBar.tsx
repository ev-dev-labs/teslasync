// Native parity port of web/src/components/data-display/MetricBar.tsx.
//
// Replaces the framer-motion `motion.div` width tween, DOM div/span elements,
// Tailwind utility classes, and the CSS linear-gradient/box-shadow with React
// Native primitives: an `Animated.View` fill grows from 0% to the clamped
// percentage using the same cubic-bezier easing and 1s duration, the label uses
// the secondary text token, and the right-aligned value/sublabel readout keeps
// the per-bar color plus monospace intent. The `sublabel ?? fmtNumber(value)`
// policy (an explicit empty string suppresses the value, `undefined` shows the
// formatted value) is preserved verbatim.
//
// React Native has no CSS gradient primitive and no gradient library is
// vendored here, so the gradient fill (`${color}99 -> ${color}`) collapses to a
// solid `color` fill and the `0 0 8px ${color}40` glow maps to a native
// shadow/elevation tinted with the same color. Reduced-motion users get the
// final width with no tween.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, typography} from '../../../theme/tokens';
import {useSettings} from '../../api/hooks/useSettings';

export interface MetricBarProps {
  /** Current metric value driving both the fill width and the default readout. */
  value: number;
  /** Upper bound the bar fills toward; `value / max` is clamped to 100%. */
  max: number;
  /** Per-bar accent color applied to the fill, glow, and value readout. */
  color: string;
  /** Left-aligned caption label for the metric. */
  label: string;
  /**
   * Right-aligned readout. A string (including the EMPTY string "") is rendered
   * verbatim; pass "" to suppress the textual readout when the same value is
   * shown elsewhere. When omitted (`undefined`), the formatted `value` is shown.
   * `??` (not `||`) is used so an intentional empty string is not treated as
   * "show the value".
   */
  sublabel?: string;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testID?: string;
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

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Parity analogue of web's lib/numberFormat `fmtNumber`, which reads the global
// precision/locale that `useSettings()` seeds at runtime. The native port pulls
// the same values from the native `useSettings()` query hook.
function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

/**
 * Animated bar showing a metric filling up. Native parity for the web
 * `MetricBar`: same clamped `value / max` percentage, label, value/sublabel
 * policy, and fill-grow animation, expressed with React Native primitives.
 */
export function MetricBar({
  value,
  max,
  color,
  label,
  sublabel,
  className: _className,
  style,
  testID,
}: MetricBarProps) {
  const {data: settings} = useSettings();
  const locale =
    settings?.locale && settings.locale.trim() ? settings.locale : 'en-US';
  const decimals = settings?.decimal_precision ?? 2;

  const rawPct = Math.min((value / max) * 100, 100);
  // Web would emit a `NaN%`/negative width here when max is 0 or value < 0;
  // React Native's Animated layout interpolation requires a finite, in-range
  // number, so guard to [0, 100] without changing the common-case result.
  const pct = Number.isFinite(rawPct) ? Math.max(0, Math.min(rawPct, 100)) : 0;

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
      duration: 1000,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: false,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pct, progress, reduceMotion]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${pct}%`],
  });

  const readout = sublabel ?? fmtNumber(value, decimals, locale);

  return (
    <View accessibilityLabel={`${label}: ${readout}`} style={style} testID={testID}>
      <View style={styles.row}>
        <AppText style={styles.label} variant="caption" weight="semibold">
          {label}
        </AppText>
        <AppText style={[styles.value, {color}]} variant="caption">
          {readout}
        </AppText>
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: color,
              shadowColor: color,
              width,
            },
          ]}
        />
      </View>
    </View>
  );
}

MetricBar.displayName = 'MetricBar';

const monoFontFamily = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  value: {
    fontFamily: monoFontFamily,
    fontSize: typography.caption,
    fontVariant: ['tabular-nums'],
  },
  track: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: 999,
    elevation: 4,
    height: '100%',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
});
