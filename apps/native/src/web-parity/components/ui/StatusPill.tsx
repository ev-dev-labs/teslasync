// Native parity port of web/src/components/ui/StatusPill.tsx.
//
// The web component (source L11-32) is a small rounded "pill" badge: an outer
// <span> (source L13-21) laying out a tiny coloured status dot (source L22-28)
// next to its `children` label. It is the shared primitive behind connection /
// health / state chips across the app.
//
// Every browser-only dependency is reduced to an explicit native-safe analog and
// documented in the .parity.json sidecar:
//   - react `forwardRef` / `HTMLAttributes<HTMLSpanElement>` / `ReactNode`
//     (source L1): `forwardRef` + `ReactNode` are preserved verbatim (the ref now
//     targets the outer `View` so callers can still `measure()` it, matching the
//     web ref-to-node intent). The DOM-only `HTMLAttributes<HTMLSpanElement>`
//     extension (source L4) and the `{...props}` spread (source L20) become the
//     idiomatic RN passthroughs actually used by callers — `style`, `testID`,
//     `accessibilityLabel`.
//   - @/lib/cn `cn()` (source L2): Tailwind class merging is meaningless on React
//     Native, so the class strings (source L15-19, L23-27) become a `View`/`Text`
//     + StyleSheet translation. The optional `className` escape hatch (source L8,
//     L18) becomes `style?: StyleProp<ViewStyle>`, applied last so callers can
//     still tweak the pill exactly like the web `className` did.
//   - Tailwind dot colour class `color` (source L6, L25; default `'bg-gray-500'`,
//     source L12): the web prop is a free-form Tailwind `bg-*` utility string.
//     `resolveStatusDotColor()` maps the standard Tailwind palette (and raw
//     hex/rgb/`bg-[...]` arbitrary values) to a concrete RN colour, defaulting to
//     gray-500 — so `bg-green-500` etc. keep the same hue they had on the web. The
//     `color` prop name + `'bg-gray-500'` default are preserved verbatim.
//   - Tailwind `animate-pulse` (source L26): CSS keyframes have no RN analog, so
//     the `pulse` prop drives an `Animated` opacity loop (1 -> 0.5 -> 1, the same
//     fade Tailwind's pulse produces). It honours the OS "reduce motion" setting
//     (the web respects `prefers-reduced-motion` via the same utility) and is torn
//     down on unmount. The `pulse` prop name + `false` default are preserved.
//   - Tailwind layout classes: `inline-flex items-center gap-1.5` (source L16) ->
//     a self-sizing (`alignSelf:'flex-start'`) row with `alignItems:'center'` and
//     a 6px gap; `rounded-full px-2.5 py-0.5` -> borderRadius 9999 / paddingH 10 /
//     paddingV 2; `text-xs font-medium` (source L16) -> 12px / weight 500 label;
//     `bg-[var(--surface-2)] text-gray-200` (source L17) -> the web `--surface-2`
//     dark value (#151621) + gray-200 (#e5e7eb); `h-1.5 w-1.5 rounded-full
//     shrink-0` (source L24) -> a 6x6, fully-rounded, non-shrinking dot.

import React, {
  forwardRef,
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
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

// Web `bg-[var(--surface-2)]` (source L17) — the dark-theme `--surface-2` value
// from web/src/index.css (L18). The native app is dark-themed.
const SURFACE_2 = '#151621';
// Web `text-gray-200` (source L17) — Tailwind gray-200.
const PILL_TEXT_COLOR = '#e5e7eb';
// Web default `color = 'bg-gray-500'` (source L12) resolves to Tailwind gray-500.
const DEFAULT_DOT_COLOR = '#6b7280';

// Concrete RN analog of the Tailwind background palette the web `color` class
// (source L6, L25) selects from. Shades 400/500/600 cover the range realistically
// used for status dots; gray also carries 300 for completeness. Values are the
// canonical Tailwind v3 hexes so a dot keeps the same hue it had on the web.
const TAILWIND_BG: Record<string, Record<string, string>> = {
  gray: {'300': '#d1d5db', '400': '#9ca3af', '500': '#6b7280', '600': '#4b5563'},
  slate: {'400': '#94a3b8', '500': '#64748b', '600': '#475569'},
  zinc: {'400': '#a1a1aa', '500': '#71717a', '600': '#52525b'},
  neutral: {'400': '#a3a3a3', '500': '#737373', '600': '#525252'},
  stone: {'400': '#a8a29e', '500': '#78716c', '600': '#57534e'},
  red: {'400': '#f87171', '500': '#ef4444', '600': '#dc2626'},
  orange: {'400': '#fb923c', '500': '#f97316', '600': '#ea580c'},
  amber: {'400': '#fbbf24', '500': '#f59e0b', '600': '#d97706'},
  yellow: {'400': '#facc15', '500': '#eab308', '600': '#ca8a04'},
  lime: {'400': '#a3e635', '500': '#84cc16', '600': '#65a30d'},
  green: {'400': '#4ade80', '500': '#22c55e', '600': '#16a34a'},
  emerald: {'400': '#34d399', '500': '#10b981', '600': '#059669'},
  teal: {'400': '#2dd4bf', '500': '#14b8a6', '600': '#0d9488'},
  cyan: {'400': '#22d3ee', '500': '#06b6d4', '600': '#0891b2'},
  sky: {'400': '#38bdf8', '500': '#0ea5e9', '600': '#0284c7'},
  blue: {'400': '#60a5fa', '500': '#3b82f6', '600': '#2563eb'},
  indigo: {'400': '#818cf8', '500': '#6366f1', '600': '#4f46e5'},
  violet: {'400': '#a78bfa', '500': '#8b5cf6', '600': '#7c3aed'},
  purple: {'400': '#c084fc', '500': '#a855f7', '600': '#9333ea'},
  fuchsia: {'400': '#e879f9', '500': '#d946ef', '600': '#c026d3'},
  pink: {'400': '#f472b6', '500': '#ec4899', '600': '#db2777'},
  rose: {'400': '#fb7185', '500': '#f43f5e', '600': '#e11d48'},
};

/**
 * Resolve the web `color` Tailwind background class (e.g. `'bg-green-500'`) to a
 * concrete React Native colour. Also accepts a raw CSS colour (`#rrggbb`, `rgb(…)`,
 * `rgba(…)`, `hsl(…)`) or a Tailwind arbitrary value (`bg-[#rrggbb]`). Unknown
 * classes fall back to gray-500, matching the web default dot colour.
 */
export function resolveStatusDotColor(color: string): string {
  const raw = color.trim();

  // Tailwind arbitrary value: bg-[#rrggbb] / bg-[rgb(...)].
  const arbitrary = raw.match(/^bg-\[(.+)\]$/);
  const candidate = arbitrary ? arbitrary[1] : raw;

  // A concrete CSS colour passed straight through.
  if (/^(#|rgb|rgba|hsl|hsla)/i.test(candidate)) {
    return candidate;
  }

  // Tailwind utility class: drop the `bg-` prefix and any `/opacity` modifier.
  const cls = candidate.replace(/^bg-/, '').replace(/\/.*$/, '');
  if (cls === 'white') {
    return '#ffffff';
  }
  if (cls === 'black') {
    return '#000000';
  }
  if (cls === 'transparent') {
    return 'transparent';
  }

  const dash = cls.lastIndexOf('-');
  if (dash > 0) {
    const hue = cls.slice(0, dash);
    const shade = cls.slice(dash + 1);
    const hex = TAILWIND_BG[hue]?.[shade];
    if (hex) {
      return hex;
    }
  }

  return DEFAULT_DOT_COLOR;
}

/**
 * Track the OS "reduce motion" accessibility setting so the pulse animation can
 * be disabled, mirroring the web `prefers-reduced-motion` behaviour behind
 * Tailwind's `animate-pulse`. Ported from the sibling AIThinkingIndicator port.
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

interface StatusDotProps {
  color: string;
  pulse: boolean;
  testID: string;
}

/**
 * The tiny status dot (web source L22-28). When `pulse` is set it fades between
 * full and half opacity on an infinite loop — the native analog of Tailwind's
 * `animate-pulse` (source L26) — unless the user has reduced motion enabled.
 */
function StatusDot({color, pulse, testID}: StatusDotProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse || reduceMotion) {
      opacity.setValue(1);
      return;
    }

    opacity.setValue(1);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.5,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [opacity, pulse, reduceMotion]);

  return (
    <Animated.View
      importantForAccessibility="no"
      style={[styles.dot, {backgroundColor: color, opacity}]}
      testID={testID}
    />
  );
}

export interface StatusPillProps {
  /** Pill label rendered next to the status dot (web source L5). */
  children: ReactNode;
  /**
   * Status dot colour. Accepts a Tailwind `bg-*` class (e.g. `'bg-green-500'`),
   * a raw CSS colour, or a `bg-[...]` arbitrary value. Defaults to gray-500,
   * matching the web `'bg-gray-500'` default (source L6, L12).
   */
  color?: string;
  /** Pulse the dot to signal a live / changing state (web source L7, L26). */
  pulse?: boolean;
  /** Native escape hatch replacing the web `className` override (source L8). */
  style?: StyleProp<ViewStyle>;
  /** Optional accessibility label for the whole pill. */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * StatusPill — a small rounded badge pairing a coloured status dot with a label.
 * Native parity port of the web StatusPill.
 */
export const StatusPill = forwardRef<View, StatusPillProps>(function StatusPill(
  {color = 'bg-gray-500', pulse = false, style, accessibilityLabel, testID, children},
  ref,
) {
  const dotColor = resolveStatusDotColor(color);
  const dotTestID = testID ? `${testID}-dot` : 'status-pill-dot';
  const labelTestID = testID ? `${testID}-label` : undefined;

  // Plain string/number children carry no styling of their own; render them in a
  // styled label so the web `text-xs font-medium text-gray-200` cascade (source
  // L16-17) is preserved. Element children are rendered as-is (web spread them
  // inside the styled span just the same).
  const label =
    typeof children === 'string' || typeof children === 'number' ? (
      <AppText style={styles.label as StyleProp<TextStyle>} testID={labelTestID}>
        {children}
      </AppText>
    ) : (
      children
    );

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      ref={ref}
      style={[styles.pill, style]}
      testID={testID}>
      <StatusDot color={dotColor} pulse={pulse} testID={dotTestID} />
      {label}
    </View>
  );
});

StatusPill.displayName = 'StatusPill';

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: SURFACE_2,
    borderRadius: 9999,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  dot: {
    borderRadius: 9999,
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  label: {
    color: PILL_TEXT_COLOR,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
});
