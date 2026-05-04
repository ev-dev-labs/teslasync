import { useState, useEffect } from 'react';
import { cn } from '@/lib/cn';

type FreshnessStatus = 'fresh' | 'stale' | 'offline' | 'unknown';

interface FreshnessIndicatorProps {
  /** ISO timestamp of last update */
  timestamp: string | null | undefined;
  /** Seconds before data is considered "stale" (default: 120) */
  staleThreshold?: number;
  /** Seconds before data is considered "offline" (default: 600) */
  offlineThreshold?: number;
  /** Show relative time label like "2m ago" (default: true) */
  showLabel?: boolean;
  /** Size variant (default: 'sm') */
  size?: 'sm' | 'md';
}
const DOT_COLOR: Record<FreshnessStatus, string> = {
  fresh: 'bg-neon-green',
  stale: 'bg-neon-amber',
  offline: 'bg-neon-red',
  unknown: 'bg-[var(--surface-2)]',
};

const DOT_SIZE: Record<string, string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
};

const LABEL_SIZE: Record<string, string> = {
  sm: 'text-[10px]',
  md: 'text-xs',
};

function computeAge(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const ms = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(ms / 1000));
}

function getStatus(age: number | null, staleThreshold: number, offlineThreshold: number): FreshnessStatus {
  if (age === null) return 'unknown';
  if (age < staleThreshold) return 'fresh';
  if (age < offlineThreshold) return 'stale';
  return 'offline';
}

function formatAge(age: number | null): string {
  if (age === null) return '—';
  if (age < 10) return 'just now';
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  return `${Math.floor(age / 3600)}h ago`;
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
 */
export function FreshnessIndicator({
  timestamp,
  staleThreshold = 120,
  offlineThreshold = 600,
  showLabel = true,
  size = 'sm',
}: FreshnessIndicatorProps) {
  const [, setTick] = useState(0);

  // Re-render every 10 seconds to keep relative time fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const age = computeAge(timestamp);
  const status = getStatus(age, staleThreshold, offlineThreshold);
  const label = formatAge(age);

  return (
    <span className="inline-flex items-center gap-1" title={timestamp ?? undefined}>
      <span
        className={cn(
          'rounded-full',
          DOT_SIZE[size],
          DOT_COLOR[status],
          status === 'fresh' && 'animate-pulse',
        )}
      />
      {showLabel && (
        <span className={cn('text-[var(--text-muted)]', LABEL_SIZE[size])}>{label}</span>
      )}
    </span>
  );
}

/** Hook to check if a timestamp is stale (useful for warning banners) */
export function useIsStale(
  timestamp: string | null | undefined,
  staleThreshold = 120,
): { isStale: boolean; isOffline: boolean; ageLabel: string } {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const age = computeAge(timestamp);
  const isStale = age !== null && age >= staleThreshold;
  const isOffline = age !== null && age >= 600;
  const ageLabel = formatAge(age);

  return { isStale, isOffline, ageLabel };
}
