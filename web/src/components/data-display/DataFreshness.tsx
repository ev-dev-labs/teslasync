import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useDateFormat } from '@/hooks/useDateFormat';

/**
 * `<DataFreshness>` — query-result-driven freshness chip.
 *
 * Renders a tiny status dot + icon + relative time string ("3m ago",
 * "updating…", "error") that surfaces the health of a data fetch. Designed
 * to live inside a widget header or page header, **not** next to the value
 * itself. For per-datum freshness (timestamp of a specific reading), use
 * `<FreshnessIndicator>` instead.
 *
 * Four states (mapped from TanStack Query):
 * - `fresh` — `dataUpdatedAt > 0`, no fetch in flight, data not stale
 * - `fetching` — `isFetching === true` (animated)
 * - `stale` — `isStale === true` (TanStack Query past `staleTime`)
 * - `error` — `isError === true`
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
}

export type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

/**
 * Shared color tier for the four freshness states. Other surfaces (e.g. the
 * status bar's "Live telemetry" segment) import this map so the visual
 * language stays consistent across the app.
 */
export const FRESHNESS_COLORS = {
  fresh: { dot: 'bg-emerald-400', text: 'text-[var(--text-secondary)]' },
  fetching: { dot: 'bg-sky-400', text: 'text-sky-300' },
  stale: { dot: 'bg-amber-400', text: 'text-amber-300' },
  error: { dot: 'bg-red-400', text: 'text-rose-300' },
} as const;

const STATUS_CONFIG = {
  fresh: {
    icon: Wifi,
    color: FRESHNESS_COLORS.fresh.text,
    dotColor: FRESHNESS_COLORS.fresh.dot,
  },
  fetching: {
    icon: RefreshCw,
    color: FRESHNESS_COLORS.fetching.text,
    dotColor: FRESHNESS_COLORS.fetching.dot,
  },
  stale: {
    icon: Wifi,
    color: FRESHNESS_COLORS.stale.text,
    dotColor: FRESHNESS_COLORS.stale.dot,
  },
  error: {
    icon: WifiOff,
    color: FRESHNESS_COLORS.error.text,
    dotColor: FRESHNESS_COLORS.error.dot,
  },
} as const;

// Centralize this once the shared
// `formatRelativeTime` helper in @/lib/dateFormat grows i18n plural support.
// Today the shared helper returns hardcoded English ("just now", "5m ago"),
// so we keep this i18n-aware variant local. Days/weeks fall-through ensures
// caggs that refresh once a day still produce a sensible chip.
function formatRelativeTime(
  ms: number,
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string,
): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  // Hold a stable "just now" for the whole first minute rather than ticking
  // 5s → 6s → 7s every second, which is visually distracting in headers.
  if (seconds < 60) return t('freshness.justNow', 'just now');
  if (seconds < 3600)
    return t('freshness.minutes', '{{m}}m ago', {
      m: Math.floor(seconds / 60),
    });
  if (seconds < 86_400)
    return t('freshness.hours', '{{h}}h ago', {
      h: Math.floor(seconds / 3600),
    });
  if (seconds < 604_800)
    return t('freshness.days', '{{d}}d ago', {
      d: Math.floor(seconds / 86_400),
    });
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
}: DataFreshnessProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  const { formatTime } = useDateFormat();
  const [, setTick] = useState(0);

  // Re-render periodically to keep the relative time label accurate. The
  // label only changes on minute boundaries now, so a 30s cadence is plenty
  // and avoids needless per-second re-renders.
  useEffect(() => {
    if (!updatedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
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
  const Icon = cfg.icon;

  // Distinguish background refetch (data on screen,
  // refetching in flight) from initial load (no data yet). The dot pulses
  // gently during background refetch so users notice an update is coming
  // without yanking the eye to the chip the way the existing ping ring does.
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

  const handleClick = useCallback(() => {
    if (onRefresh && !isFetching) onRefresh();
  }, [onRefresh, isFetching]);

  // When the user has reduced-motion enabled we
  // suppress the dot pulse but still need to communicate the in-flight
  // refetch. Surface the state via the tooltip so screen-readers + hover
  // users see "Updating…" while the data lands.
  const title = isFetching && reduce
    ? t('freshness.updatingTooltip', 'Updating…')
    : updatedAt
      ? t('freshness.lastUpdated', 'Last updated: {{time}}', {
          time: formatTime(new Date(updatedAt)),
        })
      : t('freshness.neverUpdated', 'Never updated');

  return (
    <span
      className={cn(
        'inline-flex items-center leading-none transition-colors',
        compact
          ? 'gap-0.5 text-2xs'
          : 'gap-1.5 rounded-pill border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1.5 text-xs',
        cfg.color,
        onRefresh && !isFetching && 'cursor-pointer hover:text-[var(--text-secondary)]',
      )}
      onClick={handleClick}
      title={title}
      role={onRefresh ? 'button' : 'status'}
      // `aria-live="polite"` lets screen readers
      // announce freshness state changes (e.g. "fetching" → "fresh") on
      // dashboards/widgets without yanking focus. The `aria-atomic="true"`
      // attribute groups the dot + icon + relative-time text into one
      // single utterance instead of three separate ones.
      aria-live="polite"
      aria-atomic="true"
      aria-label={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', { state: status })
      }
      data-bg-refetch={isBackgroundRefetch ? 'true' : undefined}
    >
      {/* Status dot with pulse */}
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {status === 'fetching' && !reduce && (
          <span
            className={cn(
              'absolute inset-0 rounded-full animate-ping opacity-40',
              cfg.dotColor,
            )}
          />
        )}
        <span
          className={cn(
            'relative rounded-full h-1.5 w-1.5',
            cfg.dotColor,
            showPulse && 'animate-pulse',
          )}
        />
      </span>

      <Icon
        className={cn(
          compact ? 'h-2 w-2' : 'h-2.5 w-2.5',
          status === 'fetching' && !reduce && 'animate-spin',
        )}
      />
      {/* Reserve a stable width so the label changing (e.g. "just now" →
          "updating…" → "5m ago") never reflows neighbouring header items. */}
      {!compact && (
        <span className="inline-block min-w-[4.5rem] text-left tabular-nums">
          {relativeTime}
        </span>
      )}
    </span>
  );
}

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
 * caggs (continuous aggregates) with long `staleTime` — e.g. pass
 * `6 * 60 * 60 * 1000` to flag a 6-hour-old daily cagg as amber.
 */
  forceStaleAfterMs?: number;
}

/**
 * `<DataFreshnessAuto>` — convenience wrapper that derives every
 * `<DataFreshness>` prop from a TanStack Query result. Collapses the
 * widget/page boilerplate from four props to one:
 *
 * ```tsx
 * const q = useChargingHistory(...)
 * <DataFreshnessAuto query={q} compact />
 * ```
 *
 * Preferred over `<DataFreshness>` for any caller that already has a
 * `useQuery()` result handy. .
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
      updatedAt={query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null}
      isFetching={query.isFetching}
      isStale={isStale}
      isError={query.isError}
      onRefresh={refetchable ? () => { void query.refetch(); } : undefined}
      compact={compact}
    />
  );
}
