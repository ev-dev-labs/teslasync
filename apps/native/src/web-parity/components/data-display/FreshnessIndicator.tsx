// Native parity port of web/src/components/data-display/FreshnessIndicator.tsx.
//
// Replaces the DOM span/title-tooltip and Tailwind neon classes with React
// Native primitives, native tokens, and a reduce-motion-aware pulse. Preserves
// the freshness thresholds, status mapping, relative-time labels, the 10s
// re-render tick, and the `useIsStale` hook contract.

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

import {AppText} from '../../../components/ui/AppText';

type FreshnessStatus = 'fresh' | 'stale' | 'offline' | 'unknown';
type FreshnessSize = 'sm' | 'md';

export interface FreshnessIndicatorProps {
  /** ISO timestamp of last update */
  timestamp: string | null | undefined;
  /** Seconds before data is considered "stale" (default: 120) */
  staleThreshold?: number;
  /** Seconds before data is considered "offline" (default: 600) */
  offlineThreshold?: number;
  /** Show relative time label like "2m ago" (default: true) */
  showLabel?: boolean;
  /** Size variant (default: 'sm') */
  size?: FreshnessSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

// Tailwind neon tokens resolved to literal hex (see web tailwind.config.js):
// neon-green / neon-amber / neon-red, and var(--surface-2) for the unknown dot.
const DOT_COLOR: Record<FreshnessStatus, string> = {
  fresh: '#10b981',
  stale: '#f59e0b',
  offline: '#ef4444',
  unknown: '#151621',
};

// h-1.5/h-2 (rem * 16) → device-independent pixels.
const DOT_SIZE_PX: Record<FreshnessSize, number> = {
  sm: 6,
  md: 8,
};

// text-[10px] / text-xs → font size in dp.
const LABEL_SIZE_PX: Record<FreshnessSize, number> = {
  sm: 10,
  md: 12,
};

function computeAge(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const ms = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(ms / 1000));
}

function getStatus(
  age: number | null,
  staleThreshold: number,
  offlineThreshold: number,
): FreshnessStatus {
  if (age === null) {
    return 'unknown';
  }
  if (age < staleThreshold) {
    return 'fresh';
  }
  if (age < offlineThreshold) {
    return 'stale';
  }
  return 'offline';
}

function formatAge(age: number | null): string {
  if (age === null) {
    return '—';
  }
  if (age < 10) {
    return 'just now';
  }
  if (age < 60) {
    return `${age}s ago`;
  }
  if (age < 3600) {
    return `${Math.floor(age / 60)}m ago`;
  }
  return `${Math.floor(age / 3600)}h ago`;
}

// Re-render every 10 seconds to keep relative time fresh. Mirrors the web
// component's `setTick` state so both render paths share identical cadence.
function useTenSecondTick(): void {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
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

// Native equivalent of Tailwind's `animate-pulse` (opacity 1 → .5 → 1 over 2s),
// gated on a "fresh" status and honoring the OS reduce-motion preference.
function usePulseOpacity(active: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(1);
      return;
    }

    pulse.setValue(1);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.5,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
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
  }, [active, pulse]);

  return pulse;
}

/**
 * `<FreshnessIndicator>` — age of a SPECIFIC DATA POINT.
 *
 * Renders a small colored dot + relative time label ("12s ago", "5m ago",
 * "offline") next to a value to indicate how recently it was sampled. Use
 * this when the caller already has a `timestamp` for the underlying datum
 * (e.g. last battery_level reading, last GPS fix).
 *
 * NOT to be confused with `<LiveIndicator>`. That component reflects the
 * health of the LIVE PIPE (the SSE/MQTT/polling transport), regardless of
 * whether any specific data point is fresh. A page can have a healthy
 * `<LiveIndicator>` and a stale `<FreshnessIndicator>` simultaneously when
 * the wire is up but the vehicle has stopped emitting that signal.
 *
 * The web tooltip (DOM `title`) becomes an accessibility label/hint on native.
 */
export function FreshnessIndicator({
  timestamp,
  staleThreshold = 120,
  offlineThreshold = 600,
  showLabel = true,
  size = 'sm',
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: FreshnessIndicatorProps) {
  useTenSecondTick();
  const reduceMotion = useReduceMotion();

  const age = computeAge(timestamp);
  const status = getStatus(age, staleThreshold, offlineThreshold);
  const label = formatAge(age);

  const dotSize = DOT_SIZE_PX[size];
  const pulseOpacity = usePulseOpacity(status === 'fresh' && !reduceMotion);

  return (
    <View
      accessible
      accessibilityHint={timestamp ?? undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="text"
      style={[styles.root, style]}
      testID={testID ?? dataTestID ?? 'freshness-indicator'}>
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          styles.dot,
          {
            backgroundColor: DOT_COLOR[status],
            borderRadius: dotSize / 2,
            height: dotSize,
            opacity: pulseOpacity,
            width: dotSize,
          },
        ]}
        testID="freshness-indicator-dot"
      />
      {showLabel ? (
        <AppText
          numberOfLines={1}
          style={[styles.label, {fontSize: LABEL_SIZE_PX[size]}]}
          tone="muted"
          testID="freshness-indicator-label">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

FreshnessIndicator.displayName = 'FreshnessIndicator';

/** Hook to check if a timestamp is stale (useful for warning banners) */
export function useIsStale(
  timestamp: string | null | undefined,
  staleThreshold = 120,
): {isStale: boolean; isOffline: boolean; ageLabel: string} {
  useTenSecondTick();

  const age = computeAge(timestamp);
  const isStale = age !== null && age >= staleThreshold;
  const isOffline = age !== null && age >= 600;
  const ageLabel = formatAge(age);

  return {isStale, isOffline, ageLabel};
}

const styles = StyleSheet.create({
  dot: {
    flexShrink: 0,
  },
  label: {
    lineHeight: 14,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
});
