import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

type FreshnessStatus = 'fresh' | 'stale' | 'offline' | 'unknown';

/** Minimal i18n translate signature (a subset of react-i18next's `t`). */
type TFunc = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

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
// Freshness dots share the toned-down palette used by the sibling
// `<DataFreshness>` (FRESHNESS_COLORS) and `<LiveIndicator>` so the app speaks
// one visual language for "how fresh is this".
const DOT_COLOR: Record<FreshnessStatus, string> = {
  fresh: 'bg-emerald-400',
  stale: 'bg-amber-400',
  offline: 'bg-red-400',
  unknown: 'bg-[var(--surface-2)]',
};

const DOT_SIZE: Record<'sm' | 'md', string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
};

const LABEL_SIZE: Record<'sm' | 'md', string> = {
  sm: 'text-2xs',
  md: 'text-xs',
};

// Status word used for the accessible name (and, for colour-blind users, to
// carry the meaning the dot colour alone would otherwise hide).
const STATUS_LABEL: Record<FreshnessStatus, { key: string; fallback: string }> = {
  fresh: { key: 'freshness.fresh', fallback: 'Up to date' },
  stale: { key: 'freshness.stale', fallback: 'Stale' },
  offline: { key: 'freshness.offline', fallback: 'Offline' },
  unknown: { key: 'freshness.noData', fallback: 'No recent data' },
};

/**
 * Age of a datum in whole seconds, or `null` when there is no usable
 * timestamp. A missing OR unparseable timestamp both collapse to `null`
 * (rendered as "unknown") — never `NaN`, which used to leak through as a
 * bogus "offline" dot plus a literal "NaNh ago" label.
 */
function computeAge(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return null;
  const ms = Date.now() - parsed;
  return Math.max(0, Math.floor(ms / 1000));
}

function getStatus(age: number | null, staleThreshold: number, offlineThreshold: number): FreshnessStatus {
  if (age === null) return 'unknown';
  if (age < staleThreshold) return 'fresh';
  if (age < offlineThreshold) return 'stale';
  return 'offline';
}

function formatAge(age: number | null, t: TFunc): string {
  if (age === null) return '—';
  if (age < 10) return t('freshness.justNow', 'just now');
  if (age < 60) return t('freshness.seconds', '{{s}}s ago', { s: age });
  if (age < 3600) return t('freshness.minutes', '{{m}}m ago', { m: Math.floor(age / 60) });
  return t('freshness.hours', '{{h}}h ago', { h: Math.floor(age / 3600) });
}

/**
 * Re-render on a fixed 10s cadence so the relative-time label stays honest.
 * Only armed when `active` — a null/absent/unparseable timestamp can never
 * change its label, so we skip the interval entirely and avoid a dead timer.
 */
function useAgeTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, [active]);
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
  const { t } = useTranslation();
  const age = computeAge(timestamp);
  useAgeTick(age !== null);

  const status = getStatus(age, staleThreshold, offlineThreshold);
  const label = formatAge(age, t);
  const statusWord = t(STATUS_LABEL[status].key, STATUS_LABEL[status].fallback);
  // Expose one accessible name that carries BOTH the status word (colour-blind
  // safe) and the age, so an icon-only (`showLabel={false}`) indicator is not a
  // silent dot to assistive tech.
  const ariaLabel =
    age === null
      ? statusWord
      : t('freshness.ariaLabel', '{{status}} · {{age}}', { status: statusWord, age: label });

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      title={timestamp ?? undefined}
      className="inline-flex items-center gap-1"
    >
      <span
        aria-hidden="true"
        className={cn(
          'rounded-full shrink-0',
          DOT_SIZE[size],
          DOT_COLOR[status],
          status === 'fresh' && 'animate-pulse',
        )}
      />
      {showLabel && (
        <span aria-hidden="true" className={cn('text-[var(--text-muted)]', LABEL_SIZE[size])}>
          {label}
        </span>
      )}
    </span>
  );
}

/**
 * Hook to check if a timestamp is stale (useful for warning banners).
 * Returns the boolean stale/offline flags plus a ready-to-render, i18n-aware
 * relative-age label. A missing or unparseable timestamp is reported as
 * neither stale nor offline, with an em-dash label (never `NaN`).
 */
export function useIsStale(
  timestamp: string | null | undefined,
  staleThreshold = 120,
  offlineThreshold = 600,
): { isStale: boolean; isOffline: boolean; ageLabel: string } {
  const { t } = useTranslation();
  const age = computeAge(timestamp);
  useAgeTick(age !== null);

  const isStale = age !== null && age >= staleThreshold;
  const isOffline = age !== null && age >= offlineThreshold;
  const ageLabel = formatAge(age, t);

  return { isStale, isOffline, ageLabel };
}
