// Native parity port of web/src/components/data-display/DataFreshness.tsx.
// Query-result-driven freshness chip (fresh / fetching / stale / error). The
// lucide Wifi/RefreshCw icons are represented by the coloured status dot; the
// framer pulse/spin are omitted (no animation lib in this native tree); the
// hover tooltip and i18n strings degrade to accessibilityLabel + English text.

import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import type {UseQueryResult} from '@tanstack/react-query';

import {AppText} from '../../../components/ui/AppText';

export type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

export interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Shared colour tier for the four freshness states. Ported from web. */
export const FRESHNESS_COLORS = {
  fresh: {dot: '#34d399', text: 'rgba(52, 211, 153, 0.6)'},
  fetching: {dot: '#38bdf8', text: 'rgba(56, 189, 248, 0.6)'},
  stale: {dot: '#fbbf24', text: 'rgba(251, 191, 36, 0.6)'},
  error: {dot: '#f87171', text: 'rgba(248, 113, 113, 0.6)'},
} as const;

function formatRelativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return `${Math.floor(seconds / 604_800)}w ago`;
}

export function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact = false,
  style,
  testID,
}: DataFreshnessProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!updatedAt) return;
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

  const tier = FRESHNESS_COLORS[status];

  const relativeTime =
    updatedAt && !isFetching
      ? formatRelativeTime(updatedAt)
      : isFetching
        ? 'updating…'
        : isError
          ? 'error'
          : '';

  const title = isFetching
    ? 'Updating…'
    : updatedAt
      ? `Last updated: ${new Date(updatedAt).toLocaleTimeString()}`
      : 'Never updated';

  const content = (
    <View
      accessibilityLabel={onRefresh ? 'Refresh' : `Data freshness: ${status}`}
      accessibilityRole={onRefresh ? 'button' : 'text'}
      style={[styles.row, compact ? styles.gapCompact : styles.gap, style]}
      testID={testID}>
      <View style={[styles.dot, {backgroundColor: tier.dot}]} />
      {!compact ? (
        <AppText style={[styles.label, {color: tier.text}]}>
          {relativeTime}
        </AppText>
      ) : null}
    </View>
  );

  if (onRefresh && !isFetching) {
    return (
      <Pressable accessibilityLabel={title} hitSlop={6} onPress={onRefresh}>
        {content}
      </Pressable>
    );
  }

  return content;
}

/** Subset of UseQueryResult that DataFreshnessAuto consumes. Ported from web. */
export type FreshnessQuery = Pick<
  UseQueryResult<unknown, unknown>,
  'isFetching' | 'isStale' | 'isError' | 'dataUpdatedAt' | 'refetch'
>;

export interface DataFreshnessAutoProps {
  query: FreshnessQuery;
  compact?: boolean;
  refetchable?: boolean;
  forceStaleAfterMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DataFreshnessAuto({
  query,
  compact,
  refetchable = true,
  forceStaleAfterMs,
  style,
  testID,
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
      style={style}
      testID={testID}
      updatedAt={query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 3,
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  gap: {
    gap: 4,
  },
  gapCompact: {
    gap: 2,
  },
  label: {
    fontSize: 10,
    minWidth: 64,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
});
