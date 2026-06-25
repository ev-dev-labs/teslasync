// Native parity port of web/src/components/data-display/LiveIndicator.tsx.
//
// Mirrors the four live-pipeline states (`connected` / `reconnecting` /
// `disconnected` / `unknown`) surfaced by the web `useLiveConnection` hook and
// the three visual variants (`pill` / `dot` / `compact`). Replaces lucide-react
// (Wifi / WifiOff / Loader2), the DOM <span>, Tailwind utility classes, and the
// `cn` helper with React Native primitives, native tokens, and View-drawn
// wifi/spinner glyphs.
//
// NATIVE-SAFE NOTE: the web hook subscribes to the singleton browser
// `sseManager` (EventSource), which React Native does not provide. The inlined
// `useLiveConnection` therefore reports the explicit `unknown` "unavailable"
// state by default. Callers (and tests) may inject `status` / `lastMessageAt`
// to drive any of the four states; this preserves the web default behavior
// (read the hook, no props) while remaining honest about the missing wire.

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
import {colors} from '../../../theme/tokens';

/**
 * Visual variants for `<LiveIndicator>`:
 *   - `pill`    -> colored chip with icon, label, and freshness timestamp
 *   - `dot`     -> bare colored dot, no text (use in dense headers)
 *   - `compact` -> colored chip with icon + label, but no timestamp
 */
export type LiveIndicatorVariant = 'pill' | 'dot' | 'compact';

/** Overall live-data pipeline health, mirroring the web hook union. */
export type LiveConnectionStatus =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unknown';

export interface LiveConnectionState {
  /** Overall live-data health. */
  status: LiveConnectionStatus;
  /** ISO timestamp of the last live message of any kind. */
  lastMessageAt: string | null;
}

export interface LiveIndicatorProps {
  variant?: LiveIndicatorVariant;
  /**
   * Optional override for the pipeline status. When omitted the native-safe
   * `useLiveConnection` hook is consulted (defaults to `unknown`).
   */
  status?: LiveConnectionStatus;
  /** Optional override for the last-message timestamp (pill freshness stamp). */
  lastMessageAt?: string | null;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

type LiveIconKind = 'wifi' | 'wifiOff' | 'spinner';

interface VariantConfig {
  iconKind: LiveIconKind;
  /** Foreground color for icon + label (web Tailwind text-* utility). */
  text: string;
  /** Chip background color (web Tailwind bg-* utility). */
  bg: string;
  /** Bare-dot color for the `dot` variant. */
  dot: string;
  label: string;
  spin?: boolean;
}

/**
 * React Native has no EventSource, so the singleton SSE `sseManager` that the
 * web hook relies on is unavailable. Surfaced to keep parity with the web hook
 * contract and to document why the default native status is `unknown`.
 */
export const LIVE_CONNECTION_UNAVAILABLE_REASON =
  'React Native does not provide a browser EventSource/sseManager; live pipeline health is unknown until a native SSE transport is wired.';

const ICON_SIZE = 12;
const DOT_SIZE = 8;

// Tailwind tokens resolved to literal values, preserving visual intent:
// emerald/amber/rose 300|400|500 and the unknown muted/surface tokens.
function buildConfig(
  status: LiveConnectionStatus,
  t: NativeTFunction,
): VariantConfig {
  switch (status) {
    case 'connected':
      return {
        iconKind: 'wifi',
        text: '#6ee7b7', // text-emerald-300
        bg: 'rgba(16, 185, 129, 0.1)', // bg-emerald-500/10
        dot: '#34d399', // bg-emerald-400
        label: t('live.connected', 'Live'),
      };
    case 'reconnecting':
      return {
        iconKind: 'spinner',
        text: '#fcd34d', // text-amber-300
        bg: 'rgba(245, 158, 11, 0.1)', // bg-amber-500/10
        dot: '#fbbf24', // bg-amber-400
        label: t('live.reconnecting', 'Reconnecting…'),
        spin: true,
      };
    case 'disconnected':
      return {
        iconKind: 'wifiOff',
        text: '#fda4af', // text-rose-300
        bg: 'rgba(244, 63, 94, 0.1)', // bg-rose-500/10
        dot: '#fb7185', // bg-rose-400
        label: t('live.disconnected', 'Offline'),
      };
    case 'unknown':
    default:
      return {
        iconKind: 'wifiOff',
        text: colors.textMuted, // text-[var(--text-muted)]
        bg: 'rgba(255, 255, 255, 0.03)', // bg-white/[0.03]
        dot: '#151621', // bg-[var(--surface-2)]
        label: t('live.unknown', 'Unknown'),
      };
  }
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * Native-safe parity for the web `useLiveConnection` hook. The browser SSE
 * `sseManager` has no React Native equivalent, so this reports the explicit
 * `unknown` "unavailable" state. Kept as a hook (not a constant) so a future
 * native SSE transport can be wired here without touching call sites.
 */
export function useLiveConnection(): LiveConnectionState {
  return {status: 'unknown', lastMessageAt: null};
}

/**
 * Relative time matching the web `formatRelativeTime`: "Just now", "5m ago",
 * "3h ago", or an absolute "Apr 4, 02:30 AM" fallback. Returns the universal
 * em-dash for nullish/invalid input rather than throwing.
 */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return `${diffHrs}h ago`;
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

// Native equivalent of lucide's spinning `Loader2` (animate-spin), honoring the
// OS reduce-motion preference. Returns a 0->1 driver looped over 800ms.
function useSpin(active: boolean): Animated.Value {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      spin.setValue(0);
      return;
    }

    spin.setValue(0);
    const animation = Animated.loop(
      Animated.timing(spin, {
        duration: 800,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [active, spin]);

  return spin;
}

/**
 * `<LiveIndicator>` -- at-a-glance health of the live-data pipeline.
 *
 * Renders the four states surfaced by `useLiveConnection`:
 *   - `connected`    -> emerald wifi, "Live · Xs ago"
 *   - `reconnecting` -> amber spinning loader, "Reconnecting…"
 *   - `disconnected` -> rose wifi-off, "Offline"
 *   - `unknown`      -> muted wifi-off, "Unknown" (native default)
 *
 * NOT to be confused with `<FreshnessIndicator>` -- that component reflects the
 * AGE of a single data point, this one reflects the HEALTH OF THE WIRE. Use
 * `variant="dot"` in compact navigation headers and the app shell;
 * `variant="compact"` next to header actions on data-heavy pages;
 * `variant="pill"` (default) when there is room for a freshness stamp.
 */
export function LiveIndicator({
  variant = 'pill',
  status: statusOverride,
  lastMessageAt: lastMessageAtOverride,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: LiveIndicatorProps) {
  const live = useLiveConnection();
  const t = useNativeTranslationFallback();

  const status = statusOverride ?? live.status;
  const lastMessageAt =
    lastMessageAtOverride !== undefined
      ? lastMessageAtOverride
      : live.lastMessageAt;

  const v = buildConfig(status, t);

  const showFreshness =
    variant === 'pill' && status === 'connected' && Boolean(lastMessageAt);
  const freshnessLabel = showFreshness ? formatRelativeTime(lastMessageAt) : '';
  const composedLabel = showFreshness ? `${v.label} · ${freshnessLabel}` : v.label;

  if (variant === 'dot') {
    return (
      <View
        accessibilityLabel={accessibilityLabel ?? v.label}
        accessibilityLiveRegion="polite"
        accessibilityRole="image"
        accessible
        style={[styles.dot, {backgroundColor: v.dot}, style]}
        testID={testID ?? dataTestID ?? 'live-indicator'}
      />
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel ?? composedLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessible
      style={[styles.chip, {backgroundColor: v.bg}, style]}
      testID={testID ?? dataTestID ?? 'live-indicator'}>
      <LiveStatusIcon
        color={v.text}
        kind={v.iconKind}
        size={ICON_SIZE}
        spin={Boolean(v.spin)}
      />
      <AppText
        numberOfLines={1}
        style={[styles.label, {color: v.text}]}
        testID="live-indicator-label"
        variant="caption"
        weight="semibold">
        {v.label}
      </AppText>
      {showFreshness ? (
        <AppText
          numberOfLines={1}
          style={styles.freshness}
          testID="live-indicator-freshness"
          tone="muted"
          variant="caption">
          · {freshnessLabel}
        </AppText>
      ) : null}
    </View>
  );
}

LiveIndicator.displayName = 'LiveIndicator';

interface LiveStatusIconProps {
  kind: LiveIconKind;
  color: string;
  size: number;
  spin: boolean;
}

function LiveStatusIcon({kind, color, size, spin}: LiveStatusIconProps) {
  const reduceMotion = useReduceMotion();
  const spinValue = useSpin(kind === 'spinner' && spin && !reduceMotion);

  if (kind === 'spinner') {
    const rotate = spinValue.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });
    const ringWidth = Math.max(1.4, size * 0.14);

    return (
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          styles.spinnerRing,
          {
            borderColor: colors.border,
            borderRadius: size / 2,
            borderTopColor: color,
            borderWidth: ringWidth,
            height: size,
            transform: [{rotate}],
            width: size,
          },
        ]}
        testID="live-indicator-icon"
      />
    );
  }

  return <WifiGlyph color={color} off={kind === 'wifiOff'} size={size} />;
}

// Wifi waves drawn as the colored top arcs of concentric View rings sharing a
// bottom-center origin (matching lucide's Wifi), with a base dot. The
// `wifiOff` variant overlays a diagonal slash, mirroring lucide's WifiOff.
function WifiGlyph({
  color,
  off,
  size,
}: {
  color: string;
  off: boolean;
  size: number;
}) {
  const stroke = Math.max(1.2, size * 0.12);
  const originX = size / 2;
  const originY = size * 0.84;
  const outerR = size * 0.42;
  const innerR = size * 0.22;
  const dotR = stroke * 0.95;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.iconBox, {height: size, width: size}]}
      testID="live-indicator-icon">
      <View
        style={[
          styles.arc,
          {
            borderRadius: outerR,
            borderTopColor: color,
            borderWidth: stroke,
            height: outerR * 2,
            left: originX - outerR,
            top: originY - outerR,
            width: outerR * 2,
          },
        ]}
      />
      <View
        style={[
          styles.arc,
          {
            borderRadius: innerR,
            borderTopColor: color,
            borderWidth: stroke,
            height: innerR * 2,
            left: originX - innerR,
            top: originY - innerR,
            width: innerR * 2,
          },
        ]}
      />
      <View
        style={[
          styles.wifiDot,
          {
            backgroundColor: color,
            borderRadius: dotR,
            height: dotR * 2,
            left: originX - dotR,
            top: originY - dotR,
            width: dotR * 2,
          },
        ]}
      />
      {off ? (
        <View
          style={[
            styles.slash,
            {
              backgroundColor: color,
              height: stroke,
              top: size / 2 - stroke / 2,
              width: size * 1.25,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  arc: {
    borderColor: 'transparent',
    position: 'absolute',
  },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dot: {
    borderRadius: DOT_SIZE / 2,
    flexShrink: 0,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
  freshness: {
    flexShrink: 1,
  },
  iconBox: {
    flexShrink: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  label: {
    flexShrink: 1,
  },
  slash: {
    borderRadius: 999,
    left: -2,
    position: 'absolute',
    transform: [{rotate: '-45deg'}],
  },
  spinnerRing: {
    flexShrink: 0,
  },
  wifiDot: {
    position: 'absolute',
  },
});
