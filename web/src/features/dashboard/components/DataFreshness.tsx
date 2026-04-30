import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';

interface DataFreshnessProps {
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

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const STATUS_CONFIG = {
  fresh: {
    icon: Wifi,
    color: 'text-emerald-400/60',
    dotColor: 'bg-emerald-400',
  },
  fetching: {
    icon: RefreshCw,
    color: 'text-sky-400/60',
    dotColor: 'bg-sky-400',
  },
  stale: {
    icon: Wifi,
    color: 'text-amber-400/60',
    dotColor: 'bg-amber-400',
  },
  error: {
    icon: WifiOff,
    color: 'text-red-400/60',
    dotColor: 'bg-red-400',
  },
} as const;

function formatRelativeTime(
  ms: number,
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string,
): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 5) return t('freshness.justNow', 'just now');
  if (seconds < 60)
    return t('freshness.seconds', '{{s}}s ago', { s: seconds });
  if (seconds < 3600)
    return t('freshness.minutes', '{{m}}m ago', {
      m: Math.floor(seconds / 60),
    });
  return t('freshness.hours', '{{h}}h ago', {
    h: Math.floor(seconds / 3600),
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
  const [, setTick] = useState(0);

  // Re-render every second to keep relative time accurate
  useEffect(() => {
    if (!updatedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
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

  const title = updatedAt
    ? t('freshness.lastUpdated', 'Last updated: {{time}}', {
        time: new Date(updatedAt).toLocaleTimeString(),
      })
    : t('freshness.neverUpdated', 'Never updated');

  return (
    <span
      className={cn(
        'inline-flex items-center text-[10px] leading-none transition-colors',
        compact ? 'gap-0.5' : 'gap-1',
        cfg.color,
        onRefresh && !isFetching && 'cursor-pointer hover:text-white/60',
      )}
      onClick={handleClick}
      title={title}
      role={onRefresh ? 'button' : undefined}
      aria-label={onRefresh ? t('freshness.refresh', 'Refresh') : undefined}
    >
      {/* Status dot with pulse */}
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {status === 'fetching' && (
          <span
            className={cn(
              'absolute inset-0 rounded-full animate-ping opacity-40',
              cfg.dotColor,
            )}
          />
        )}
        <span className={cn('relative rounded-full h-1.5 w-1.5', cfg.dotColor)} />
      </span>

      <Icon
        className={cn(
          compact ? 'h-2 w-2' : 'h-2.5 w-2.5',
          status === 'fetching' && 'animate-spin',
        )}
      />
      {!compact && <span>{relativeTime}</span>}
    </span>
  );
}
