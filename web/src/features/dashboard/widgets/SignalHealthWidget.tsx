import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { StatCard } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useSignalStats, useSignalGaps, useSignals } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtInt } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface GapSignal {
  name: string;
  lastSeen: string | null;
  isStale: boolean;
}

export default function SignalHealthWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = useSignalStats(id);

  const { data: gapData } = useSignalGaps(id);
  const { data: signals } = useSignals(id);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const analysis = useMemo(() => {
    const allSignals = signals ?? [];
    const totalSignals = allSignals.length;
    const liveEntries = gapData ?? {};
    const now = Date.now();

    let activeCount = 0;
    let staleCount = 0;
    let latestTimestamp: string | null = null;
    let latestMs: number | null = null;
    const gapSignals: GapSignal[] = [];

    for (const [name, entry] of Object.entries(liveEntries)) {
      const ts = entry?.timestamp ?? null;
      const parsedMs = ts ? new Date(ts).getTime() : Number.NaN;
      // A missing OR unparseable timestamp is a signal gap: it must count as
      // stale (never "active"), and it must not poison the freshness reading
      // with NaN via the newest-timestamp comparison below. Comparing parsed
      // millis (not the raw ISO strings) also keeps ordering correct when
      // timestamps differ in precision (e.g. with/without milliseconds).
      if (ts && Number.isFinite(parsedMs)) {
        const age = now - parsedMs;
        if (age > STALE_THRESHOLD_MS) {
          staleCount++;
          gapSignals.push({ name, lastSeen: ts, isStale: true });
        } else {
          activeCount++;
        }
        if (latestMs === null || parsedMs > latestMs) {
          latestMs = parsedMs;
          latestTimestamp = ts;
        }
      } else {
        staleCount++;
        gapSignals.push({ name, lastSeen: null, isStale: true });
      }
    }

    // Sort gap signals: null last-seen first, then oldest
    gapSignals.sort((a, b) => {
      if (!a.lastSeen && !b.lastSeen) return a.name.localeCompare(b.name);
      if (!a.lastSeen) return -1;
      if (!b.lastSeen) return 1;
      return new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
    });

    // Freshness age in seconds, derived from the newest VALID timestamp so an
    // unparseable value can never surface as "NaN…" in the freshness label.
    const freshnessAge = latestMs !== null
      ? Math.max(0, Math.floor((now - latestMs) / 1000))
      : null;

    return { totalSignals, activeCount, staleCount, gapSignals, freshnessAge, latestTimestamp };
  }, [signals, gapData]);

  // Color coding: green = all fresh, amber = some stale, red = many gaps
  const healthLevel = useMemo(() => {
    const { activeCount, staleCount } = analysis;
    const total = activeCount + staleCount;
    if (total === 0) return 'neutral';
    const staleRatio = staleCount / total;
    if (staleRatio >= 0.5) return 'red';
    if (staleRatio > 0) return 'amber';
    return 'green';
  }, [analysis]);

  const healthColor = healthLevel === 'green'
    ? 'text-green-400'
    : healthLevel === 'amber'
      ? 'text-amber-400'
      : healthLevel === 'red'
        ? 'text-red-400'
        : 'text-[var(--text-muted)]';

  const healthBadgeVariant = healthLevel === 'green'
    ? 'success' as const
    : healthLevel === 'amber'
      ? 'warning' as const
      : healthLevel === 'red'
        ? 'danger' as const
        : 'neutral' as const;

  function formatAge(seconds: number | null): string {
    if (seconds == null) return '—';
    if (seconds < 60) return t('widget.signalHealth.secAgo', '{{count}}s ago', { count: seconds });
    if (seconds < 3600) return t('widget.signalHealth.minAgo', '{{count}}m ago', { count: Math.floor(seconds / 60) });
    return t('widget.signalHealth.hrAgo', '{{count}}h ago', { count: Math.floor(seconds / 3600) });
  }

  const hasData = stats || signals || gapData;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.signalHealth.title', 'Signal Health')}
      icon={<Activity className={`h-3.5 w-3.5 ${healthColor}`} />}
      loading={statsLoading}
      updatedAt={statsUpdatedAt}
      isFetching={statsFetching}
      isStale={statsStale}
      isError={statsError}
      onRefresh={() => refetchStats()}
    >
      {!hasData ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.signalHealth.noData', 'No signal health data')}
          className="py-4"
        />
      ) : isCompact ? (
        /* ── Compact layout (1-col) ── */
        <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
          <Badge variant={healthBadgeVariant} className="text-xs">
            {analysis.activeCount}/{analysis.activeCount + analysis.staleCount}
          </Badge>
          <span className="text-lg font-bold text-[var(--text-primary)]">
            {fmtInt(analysis.totalSignals)}
          </span>
          <span className="text-2xs text-[var(--text-secondary)]">
            {t('widget.signalHealth.signals', 'signals')}
          </span>
          {analysis.freshnessAge != null && (
            <span className={`text-xs ${healthColor}`}>
              {formatAge(analysis.freshnessAge)}
            </span>
          )}
        </div>
      ) : (
        /* ── Standard / Wide layout ── */
        <div className="flex flex-col gap-3 h-full">
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label={t('widget.signalHealth.totalSignals', 'Total Signals')}
              value={fmtInt(analysis.totalSignals)}
              icon={<Activity className="h-3.5 w-3.5 text-neon-cyan" />}
            />
            <StatCard
              label={t('widget.signalHealth.active', 'Active')}
              value={fmtInt(analysis.activeCount)}
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
            />
            <StatCard
              label={t('widget.signalHealth.withGaps', 'With Gaps')}
              value={fmtInt(analysis.staleCount)}
              icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
            />
            <StatCard
              label={t('widget.signalHealth.freshness', 'Freshness')}
              value={formatAge(analysis.freshnessAge)}
              icon={<Clock className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
            />
          </div>

          {/* Health badge */}
          <div className="flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
              {t('widget.signalHealth.status', 'Status')}
            </span>
            <Badge variant={healthBadgeVariant} className="text-2xs">
              {healthLevel === 'green'
                ? t('widget.signalHealth.healthy', 'Healthy')
                : healthLevel === 'amber'
                  ? t('widget.signalHealth.degraded', 'Degraded')
                  : healthLevel === 'red'
                    ? t('widget.signalHealth.critical', 'Critical')
                    : t('widget.signalHealth.unknown', 'Unknown')}
            </Badge>
          </div>

          {/* Wide view: stale signal list */}
          {isWide && analysis.gapSignals.length > 0 && (
            <div className="mt-auto pt-2 border-t border-white/[0.06] flex-1 min-h-0 overflow-y-auto">
              <h4 className="text-2xs font-semibold uppercase text-[var(--text-muted)] mb-1.5">
                {t('widget.signalHealth.staleSignals', 'Stale / Gap Signals')}
              </h4>
              <div className="space-y-1">
                {analysis.gapSignals.slice(0, isCompact ? 3 : 15).map((sig) => (
                  <div key={sig.name} className="flex items-center justify-between min-h-[28px]">
                    <span className="text-xs text-[var(--text-secondary)] truncate max-w-[45%]">
                      {sig.name}
                    </span>
                    <span className="text-2xs text-[var(--text-muted)] truncate">
                      {sig.lastSeen ? formatRelative(sig.lastSeen) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
