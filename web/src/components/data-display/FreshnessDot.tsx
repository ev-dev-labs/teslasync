import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useDateFormat } from '@/hooks/useDateFormat';
import { IconButton } from '@/components/ui/IconButton';

/**
 * `<FreshnessDot>` — the one freshness indicator: an icon-only state dot
 * that is also the refresh action. Age, status and source live in its
 * tooltip and accessible name (hover and focus), never as visible text.
 * Designed for widget, card, table and page headers, clustered with the
 * other icon actions at the right.
 *
 * Four states (mapped from TanStack Query):
 * - `fresh` — `dataUpdatedAt > 0`, no fetch in flight, data not stale
 * - `fetching` — `isFetching === true` (animated)
 * - `stale` — `isStale === true` (TanStack Query past `staleTime`)
 * - `error` — `isError === true`
 *
 * For most callers, prefer `<FreshnessDotAuto query={query} />` which takes
 * the entire `useQuery()` result and wires every prop in one line.

 */
export interface FreshnessDotProps {
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
  /** Optional data-source label shown in the hover and accessible detail. */
  source?: string;
  /** Force stale once the successful update is older than this duration. */
  forceStaleAfterMs?: number;
  /** Expected polling cadence; data becomes stale after two missed intervals. */
  refreshIntervalMs?: number;
  /** Use the 15-minute fallback when the source has no polling cadence. */
  manual?: boolean;
  /** Smaller dot and touch target for title-less widget overlays. */
  compact?: boolean;
}

export type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

/**
 * Shared color tier for the four freshness states. Other surfaces (e.g. the
 * status bar's "Live telemetry" segment) import this map so the visual
 * language stays consistent across the app.
 */
export const FRESHNESS_COLORS = {
  fresh: { dot: 'bg-[var(--semantic-success)]', text: 'text-[var(--text-secondary)]' },
  fetching: { dot: 'bg-[var(--semantic-info)]', text: 'text-[var(--semantic-info)]' },
  stale: { dot: 'bg-[var(--semantic-warning)]', text: 'text-[var(--semantic-warning)]' },
  error: { dot: 'bg-[var(--semantic-danger)]', text: 'text-[var(--semantic-danger)]' },
} as const;

const STATUS_CONFIG = {
  fresh: { dotColor: FRESHNESS_COLORS.fresh.dot },
  fetching: { dotColor: FRESHNESS_COLORS.fetching.dot },
  stale: { dotColor: FRESHNESS_COLORS.stale.dot },
  error: { dotColor: FRESHNESS_COLORS.error.dot },
} as const;

const STATUS_LABEL = {
  fresh: { key: 'freshness.fresh', fallback: 'Up to date' },
  fetching: { key: 'freshness.updating', fallback: 'Updating…' },
  stale: { key: 'freshness.stale', fallback: 'Stale' },
  error: { key: 'freshness.error', fallback: 'Error' },
} as const;

let freshnessTick = 0;
let freshnessTimer: ReturnType<typeof setInterval> | null = null;
const freshnessSubscribers = new Set<() => void>();

function subscribeToFreshnessTicker(subscriber: () => void) {
  freshnessSubscribers.add(subscriber);
  if (freshnessTimer == null) {
    freshnessTimer = setInterval(() => {
      freshnessTick += 1;
      freshnessSubscribers.forEach((notify) => notify());
    }, 30_000);
  }
  return () => {
    freshnessSubscribers.delete(subscriber);
    if (freshnessSubscribers.size === 0 && freshnessTimer != null) {
      clearInterval(freshnessTimer);
      freshnessTimer = null;
    }
  };
}

const noTickerSubscription = () => () => undefined;
const getFreshnessTick = () => freshnessTick;

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
  // 5s → 6s → 7s every second.
  // relative-time: the dot's age, shown only in its tooltip and accessible name
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

export function FreshnessDot({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  source,
  forceStaleAfterMs,
  refreshIntervalMs,
  manual = false,
  compact = false,
}: FreshnessDotProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  const { formatTime } = useDateFormat();
  // All mounted freshness indicators share one clock instead of each owning a timer.
  useSyncExternalStore(
    updatedAt ? subscribeToFreshnessTicker : noTickerSubscription,
    getFreshnessTick,
    getFreshnessTick,
  );

  const staleAfterMs = forceStaleAfterMs ?? (
    refreshIntervalMs != null ? refreshIntervalMs * 2 : manual ? 15 * 60_000 : null
  );
  const forcedStale =
    staleAfterMs != null &&
    updatedAt != null &&
    Date.now() - updatedAt >= staleAfterMs;
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale || forcedStale
        ? 'stale'
        : 'fresh';
  const previousUpdatedAt = useRef(updatedAt);
  const [pingNewData, setPingNewData] = useState(false);
  useEffect(() => {
    const hadPreviousValue = previousUpdatedAt.current != null;
    const timestampAdvanced = hadPreviousValue && updatedAt != null && previousUpdatedAt.current !== updatedAt;
    previousUpdatedAt.current = updatedAt;
    if (status !== 'fresh' || !timestampAdvanced) {
      setPingNewData(false);
      return;
    }
    setPingNewData(true);
    const timeout = setTimeout(() => setPingNewData(false), 1600);
    return () => clearTimeout(timeout);
  }, [status, updatedAt]);

  const cfg = STATUS_CONFIG[status];

  const ageLabel = updatedAt ? formatRelativeTime(updatedAt, t) : '';

  const handleClick = useCallback(() => {
    if (onRefresh && !isFetching) onRefresh();
  }, [onRefresh, isFetching]);

  // Reduced motion keeps the in-flight state explicit without the spinner.
  const updateTitle = isFetching && reduce
    ? t('freshness.updatingTooltip', 'Updating…')
    : updatedAt
      ? t('freshness.lastUpdated', 'Last updated: {{time}}', {
          time: formatTime(new Date(updatedAt)),
        })
      : t('freshness.neverUpdated', 'Never updated');
  const sourceTitle = source
    ? t('freshness.source', 'Source: {{source}}', { source })
    : null;
  const statusLabel = t(STATUS_LABEL[status].key, STATUS_LABEL[status].fallback);
  const stateLabel = ageLabel
    ? t('freshness.ariaLabel', '{{status}} · {{age}}', {
        status: statusLabel,
        age: ageLabel,
      })
    : statusLabel;
  const accessibleState = sourceTitle
    ? `${stateLabel} · ${sourceTitle}`
    : stateLabel;
  const ariaLabel = onRefresh
    ? t('freshness.refreshState', 'Refresh data · {{state}}', { state: accessibleState })
    : t('a11y.dataFreshness', 'Data freshness: {{state}}', { state: accessibleState });
  return (
    <IconButton
      icon={(
        <span
          className={cn(
            'relative shrink-0 rounded-full',
            compact ? 'h-2 w-2' : 'h-2.5 w-2.5',
            status === 'stale'
              ? 'border border-[var(--semantic-warning)] bg-transparent'
              : cfg.dotColor,
            status === 'error' && !reduce && 'animate-[pulse_2s_ease-in-out_infinite]',
            status === 'fetching' && !reduce && 'animate-pulse',
          )}
          aria-hidden="true"
        >
          {pingNewData && status === 'fresh' && !reduce && (
            <span className={cn('absolute inset-0 animate-ping [animation-iteration-count:2] rounded-full opacity-60', cfg.dotColor)} />
          )}
        </span>
      )}
      label={[ariaLabel, updateTitle].join(' · ')}
      aria-label={ariaLabel}
      variant="ghost"
      onClick={onRefresh ? handleClick : undefined}
      busy={isFetching}
      disabled={!onRefresh || isFetching}
      className={compact ? '!h-5 !w-5 !min-h-0 !min-w-0 !p-0' : '!h-7 !w-7 !min-h-0 !min-w-0 !p-0'}
    />
  );
}

/**
 * Subset of `UseQueryResult` that `<FreshnessDotAuto>` consumes. Kept loose
 * (`unknown` data, `unknown` error) so the wrapper accepts any TanStack Query
 * result without leaking generics into call sites.
 */
export type FreshnessQuery = Pick<
  UseQueryResult<unknown, unknown>,
  'isFetching' | 'isStale' | 'isError' | 'dataUpdatedAt' | 'refetch'
>;

export interface FreshnessDotAutoProps {
  /** Pass the entire TanStack Query result (the object returned by `useQuery`). */
  query: FreshnessQuery;
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
  /** Optional data-source label shown in the hover and accessible detail. */
  source?: string;
  /** Expected polling cadence; data becomes stale after two missed intervals. */
  refreshIntervalMs?: number;
  /** Use the 15-minute fallback when the source has no polling cadence. */
  manual?: boolean;
  /** Smaller dot and touch target for title-less widget overlays. */
  compact?: boolean;
}

/**
 * `<FreshnessDotAuto>` — convenience wrapper that derives every
 * `<FreshnessDot>` prop from a TanStack Query result. Collapses the
 * widget/page boilerplate from four props to one:
 *
 * ```tsx
 * const q = useChargingHistory(...)
 * <FreshnessDotAuto query={q} compact />
 * ```
 *
 * Preferred over `<FreshnessDot>` for any caller that already has a
 * `useQuery()` result handy. .
 */
export function FreshnessDotAuto({
  query,
  refetchable = true,
  forceStaleAfterMs,
  source,
  refreshIntervalMs,
  manual,
  compact,
}: FreshnessDotAutoProps) {
  return (
    <FreshnessDot
      updatedAt={query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null}
      isFetching={query.isFetching}
      isStale={query.isStale}
      isError={query.isError}
      onRefresh={refetchable ? () => { void query.refetch(); } : undefined}
      source={source}
      forceStaleAfterMs={forceStaleAfterMs}
      refreshIntervalMs={refreshIntervalMs}
      manual={manual}
      compact={compact}
    />
  );
}
