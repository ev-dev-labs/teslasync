// Native parity port of web/src/components/data-display/DataFreshness.tsx.
// Preserves the TanStack Query freshness mapping, relative-time labels,
// reduced-motion behavior, and refetch affordance using React Native primitives.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type {UseQueryResult} from '@tanstack/react-query';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

type NativeTFunction = (
  key: string,
  fallback: string,
  opts?: Record<string, unknown>,
) => string;

/**
 * `<DataFreshness>` - query-result-driven freshness chip.
 *
 * Renders a tiny status dot + icon + relative time string ("3m ago",
 * "updating...", "error") that surfaces the health of a data fetch. Designed
 * to live inside a widget header or page header, not next to the value itself.
 * For per-datum freshness (timestamp of a specific reading), use
 * `<FreshnessIndicator>` instead.
 *
 * Four states (mapped from TanStack Query):
 * - `fresh` - `dataUpdatedAt > 0`, no fetch in flight, data not stale
 * - `fetching` - `isFetching === true` (animated unless reduced motion)
 * - `stale` - `isStale === true` (TanStack Query past `staleTime`)
 * - `error` - `isError === true`
 *
 * For most callers, prefer `<DataFreshnessAuto query={query} />` which takes
 * the entire `useQuery()` result and wires every prop in one line.
 */
export interface DataFreshnessProps {
  /** When the data was last successfully fetched (ms timestamp or null) */
  updatedAt: number | null;
  /** Is TanStack Query currently fetching? */
  isFetching: boolean;
  /** Is data stale (past its staleTime)? */
  isStale: boolean;
  /** Is there an error? */
  isError: boolean;
  /** Manual refresh callback */
  onRefresh?: () => void;
  /** Compact mode (condensed icon, no text) for small widgets */
  compact?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

export type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

/**
 * Shared color tier for the four freshness states. Native surfaces import the
 * same keys as the web map, but values are React Native color strings rather
 * than Tailwind class names.
 */
export const FRESHNESS_COLORS = {
  fresh: {dot: colors.success, text: 'rgba(52, 211, 153, 0.72)'},
  fetching: {dot: colors.accent, text: 'rgba(53, 213, 255, 0.72)'},
  stale: {dot: colors.warning, text: 'rgba(251, 191, 36, 0.72)'},
  error: {dot: colors.danger, text: 'rgba(251, 113, 133, 0.72)'},
} as const;

const STATUS_CONFIG = {
  fresh: {
    glyph: 'WF',
    color: FRESHNESS_COLORS.fresh.text,
    dotColor: FRESHNESS_COLORS.fresh.dot,
  },
  fetching: {
    glyph: 'RE',
    color: FRESHNESS_COLORS.fetching.text,
    dotColor: FRESHNESS_COLORS.fetching.dot,
  },
  stale: {
    glyph: 'WF',
    color: FRESHNESS_COLORS.stale.text,
    dotColor: FRESHNESS_COLORS.stale.dot,
  },
  error: {
    glyph: 'WX',
    color: FRESHNESS_COLORS.error.text,
    dotColor: FRESHNESS_COLORS.error.dot,
  },
} as const;

function interpolate(fallback: string, opts?: Record<string, unknown>): string {
  if (!opts) {
    return fallback;
  }

  return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = opts[key];
    return value == null ? match : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      interpolate(fallback, opts),
    [],
  );
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
  active: boolean,
  reduceMotion: boolean,
  durationMs: number,
): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      pulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
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
  }, [active, durationMs, pulse, reduceMotion]);

  return pulse;
}

function useLoopingSpin(
  active: boolean,
  reduceMotion: boolean,
): Animated.Value {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      spin.setValue(0);
      return;
    }

    spin.setValue(0);
    const animation = Animated.loop(
      Animated.timing(spin, {
        duration: 900,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [active, reduceMotion, spin]);

  return spin;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Centralize this once the shared date formatter grows i18n plural support.
// Days/weeks fall-through keeps once-a-day aggregate refreshes readable.
function formatRelativeTime(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {
      m: Math.floor(seconds / 60),
    });
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {
      h: Math.floor(seconds / 3600),
    });
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {
      d: Math.floor(seconds / 86_400),
    });
  }
  return t('freshness.weeks', '{{w}}w ago', {
    w: Math.floor(seconds / 604_800),
  });
}

export function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact = false,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
}: DataFreshnessProps) {
  const t = useNativeTranslationFallback();
  const reduce = useReduceMotion();
  const [, setTick] = useState(0);

  // Re-render periodically to keep the relative time label accurate. The
  // label only changes on minute boundaries, so a 30s cadence is enough.
  useEffect(() => {
    if (!updatedAt) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const cfg = STATUS_CONFIG[status];

  // Distinguish background refetch (data on screen, refetching in flight) from
  // initial load (no data yet). The dot pulses gently during background refetch.
  const isBackgroundRefetch = isFetching && updatedAt != null;
  const showPulse = isBackgroundRefetch && !reduce;

  const relativeTime =
    updatedAt && !isFetching
      ? formatRelativeTime(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const handlePress = useCallback(() => {
    if (onRefresh && !isFetching) {
      onRefresh();
    }
  }, [isFetching, onRefresh]);

  const title =
    isFetching && reduce
      ? t('freshness.updatingTooltip', 'Updating…')
      : updatedAt
        ? t('freshness.lastUpdated', 'Last updated: {{time}}', {
            time: formatTime(new Date(updatedAt)),
          })
        : t('freshness.neverUpdated', 'Never updated');

  const label = onRefresh
    ? t('freshness.refresh', 'Refresh')
    : t('a11y.dataFreshness', 'Data freshness: {{state}}', {state: status});

  const rootStyles = [
    styles.root,
    compact ? styles.rootCompact : styles.rootRegular,
    {opacity: onRefresh && !isFetching ? 1 : 0.94},
    style,
  ];

  const content = (
    <>
      <FreshnessDot
        color={cfg.dotColor}
        reduceMotion={reduce}
        showPing={status === 'fetching' && !reduce}
        showPulse={showPulse}
      />
      <FreshnessGlyph
        color={cfg.color}
        compact={compact}
        glyph={cfg.glyph}
        reduceMotion={reduce}
        spinning={status === 'fetching'}
      />
      {!compact ? (
        <AppText
          numberOfLines={1}
          style={[styles.label, {color: cfg.color}]}
          testID="data-freshness-relative-time"
          variant="caption">
          {relativeTime}
        </AppText>
      ) : null}
    </>
  );

  if (onRefresh) {
    return (
      <Pressable
        accessibilityHint={title}
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
        accessibilityRole="button"
        accessibilityState={{busy: isFetching, disabled: isFetching}}
        disabled={isFetching}
        hitSlop={8}
        onPress={handlePress}
        style={({pressed}) => [
          ...rootStyles,
          pressed && !isFetching ? styles.pressed : null,
        ]}
        testID={testID ?? dataTestID ?? 'data-freshness'}>
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityHint={title}
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessible
      style={rootStyles}
      testID={testID ?? dataTestID ?? 'data-freshness'}>
      {content}
    </View>
  );
}

function FreshnessDot({
  color,
  reduceMotion,
  showPing,
  showPulse,
}: {
  color: string;
  reduceMotion: boolean;
  showPing: boolean;
  showPulse: boolean;
}) {
  const ping = useLoopingPulse(showPing, reduceMotion, 1200);
  const pulse = useLoopingPulse(showPulse, reduceMotion, 1500);
  const pingStyle = showPing
    ? {
        opacity: ping.interpolate({
          inputRange: [0, 1],
          outputRange: [0.42, 0],
        }),
        transform: [
          {
            scale: ping.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 2.8],
            }),
          },
        ],
      }
    : null;
  const dotPulseStyle = showPulse
    ? {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.68, 1],
        }),
      }
    : null;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.dotWrap}
      testID="data-freshness-dot">
      {showPing ? (
        <Animated.View
          style={[styles.pingDot, {backgroundColor: color}, pingStyle]}
        />
      ) : null}
      <Animated.View
        style={[styles.dot, {backgroundColor: color}, dotPulseStyle]}
      />
    </View>
  );
}

function FreshnessGlyph({
  color,
  compact,
  glyph,
  reduceMotion,
  spinning,
}: {
  color: string;
  compact: boolean;
  glyph: string;
  reduceMotion: boolean;
  spinning: boolean;
}) {
  const spin = useLoopingSpin(spinning, reduceMotion);
  const spinStyle =
    spinning && !reduceMotion
      ? {
          transform: [
            {
              rotate: spin.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', '360deg'],
              }),
            },
          ],
        }
      : null;

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.glyphWrap, compact ? styles.glyphCompact : null, spinStyle]}
      testID="data-freshness-icon">
      <AppText
        style={[styles.glyph, compact ? styles.glyphTextCompact : null, {color}]}
        variant="caption"
        weight="bold">
        {glyph}
      </AppText>
    </Animated.View>
  );
}

DataFreshness.displayName = 'DataFreshness';

/**
 * Subset of `UseQueryResult` that `<DataFreshnessAuto>` consumes. Kept loose
 * (`unknown` data, `unknown` error) so the wrapper accepts any TanStack Query
 * result without leaking generics into call sites.
 */
export type FreshnessQuery = Pick<
  UseQueryResult<unknown, unknown>,
  'isFetching' | 'isStale' | 'isError' | 'dataUpdatedAt' | 'refetch'
>;

export interface DataFreshnessAutoProps {
  /** Pass the entire TanStack Query result (the object returned by `useQuery`). */
  query: FreshnessQuery;
  /** Compact mode (icon-only, no relative time text). */
  compact?: boolean;
  /**
   * Default `true`: clicking the indicator triggers `query.refetch()`. Set
   * `false` for read-only displays where a manual refresh would be confusing
   * (e.g. when the data is owned by an out-of-band poll cycle).
   */
  refetchable?: boolean;
  /**
   * Optional override for the staleness window in ms. When set, the chip
   * forces the `stale` visual once `Date.now() - dataUpdatedAt` exceeds this
   * value, even if TanStack Query's `isStale` is still `false`. Useful for
   * caggs (continuous aggregates) with long `staleTime` - e.g. pass
   * `6 * 60 * 60 * 1000` to flag a 6-hour-old daily cagg as amber.
   */
  forceStaleAfterMs?: number;
}

/**
 * `<DataFreshnessAuto>` - convenience wrapper that derives every
 * `<DataFreshness>` prop from a TanStack Query result. Collapses the
 * widget/page boilerplate from four props to one:
 *
 * ```tsx
 * const q = useChargingHistory(...)
 * <DataFreshnessAuto query={q} compact />
 * ```
 *
 * Preferred over `<DataFreshness>` for any caller that already has a
 * `useQuery()` result handy.
 */
export function DataFreshnessAuto({
  query,
  compact,
  refetchable = true,
  forceStaleAfterMs,
}: DataFreshnessAutoProps) {
  const isStale =
    query.isStale ||
    (forceStaleAfterMs != null && query.dataUpdatedAt
      ? Date.now() - query.dataUpdatedAt > forceStaleAfterMs
      : false);

  return (
    <DataFreshness
      compact={compact}
      isError={query.isError}
      isFetching={query.isFetching}
      isStale={isStale}
      onRefresh={
        refetchable
          ? () => {
              void query.refetch();
            }
          : undefined
      }
      updatedAt={query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null}
    />
  );
}

DataFreshnessAuto.displayName = 'DataFreshnessAuto';

const styles = StyleSheet.create({
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  dotWrap: {
    alignItems: 'center',
    height: 8,
    justifyContent: 'center',
    position: 'relative',
    width: 8,
  },
  glyph: {
    fontSize: 9,
    letterSpacing: 0.2,
    lineHeight: 11,
  },
  glyphCompact: {
    height: 10,
    width: 12,
  },
  glyphTextCompact: {
    fontSize: 8,
    lineHeight: 10,
  },
  glyphWrap: {
    alignItems: 'center',
    height: 12,
    justifyContent: 'center',
    width: 16,
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
    minWidth: 72,
  },
  pingDot: {
    borderRadius: 3,
    height: 6,
    position: 'absolute',
    width: 6,
  },
  pressed: {
    opacity: 0.76,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
  },
  rootCompact: {
    gap: 2,
  },
  rootRegular: {
    gap: spacing.xs,
  },
});
