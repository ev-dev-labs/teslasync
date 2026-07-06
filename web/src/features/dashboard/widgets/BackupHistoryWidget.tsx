import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryFull, Zap } from 'lucide-react';
import { StatCard } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useTeslaBackupHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { fmtInt } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/** Format seconds into human-readable duration (e.g. "2h 15m", "45m", "30s"). */
export function fmtDuration(seconds: number): string {
  // Guard non-finite / negative input so a corrupt reading never renders
  // "NaNm" or "-5s"; treat anything unusable as a zero-length outage.
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  // Round to whole seconds *before* the sub-minute check so a value like
  // 59.6s reads as "1m" rather than the nonsensical "60s".
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hrs > 0) return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
  return `${mins}m`;
}

/** 30 days ago in ISO date form (YYYY-MM-DD). */
export function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** Parse an event timestamp to epoch ms, treating missing/invalid as 0. */
function toTime(ts?: string): number {
  const t = new Date(ts ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

export default function BackupHistoryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime: fmtEventTime } = useDateFormat();

  // ── Energy sites (to get siteId) ──
  const {
    data: sites,
    isLoading: sitesLoading,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;
  const hasSites = (sites ?? []).length > 0;

  // ── Backup history (30 days) ──
  const since = useMemo(() => thirtyDaysAgo(), []);

  const {
    data: events,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsIsError,
    dataUpdatedAt: eventsUpdatedAt,
    refetch: refetchEvents,
  } = useTeslaBackupHistory(siteId, since);

  // ── Combined freshness props ──
  const isLoading = sitesLoading || (!!siteId && eventsLoading);
  const isFetching = sitesFetching || eventsFetching;
  const isStale = sitesStale || eventsStale;
  const isError = sitesIsError || eventsIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, eventsUpdatedAt ?? 0);

  const handleRefresh = () => {
    refetchSites();
    if (siteId) refetchEvents();
  };

  // ── Derived stats ──
  const items = useMemo(() => events ?? [], [events]);

  const totalOutages = items.length;

  const avgDurationSec = useMemo(() => {
    if (items.length === 0) return 0;
    const totalSec = items.reduce((sum, ev) => sum + (ev.duration_seconds ?? 0), 0);
    return totalSec / items.length;
  }, [items]);

  const isCompact = size.cols <= 1;
  const maxEvents = isCompact ? 3 : 10;

  const sortedItems = useMemo(
    () =>
      [...items]
        .sort((a, b) => toTime(b.timestamp) - toTime(a.timestamp))
        .slice(0, maxEvents),
    [items, maxEvents],
  );

  // ── No energy sites linked ──
  if (!hasSites && !isLoading) {
    return (
      <WidgetShell
        loading={false}
        error={null}
        updatedAt={sitesUpdatedAt}
        isFetching={sitesFetching}
        isStale={sitesStale}
        isError={sitesIsError}
        onRefresh={() => refetchSites()}
      >
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BatteryFull className="h-5 w-5" />}
          message={t('widget.backupHistory.noSite', 'No Tesla Energy site linked')}
          className="py-4"
        />
      </WidgetShell>
    );
  }

  // ── Compact layout (1-col) ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={null}
        updatedAt={updatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {items.length === 0 && !isLoading ? (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<BatteryFull className="h-5 w-5" />}
            message={t('widget.backupHistory.noEvents', 'No backup events in the last 30 days')}
            className="py-4"
          />
        ) : (
          <div className="flex flex-col gap-2">
            <StatCard
              label={t('widget.backupHistory.outages30d', 'Outages (30d)')}
              value={fmtInt(totalOutages)}
            />
            <ul className="overflow-y-auto space-y-1.5">
              {sortedItems.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 min-h-[44px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span className="text-xs text-[var(--text-secondary)] truncate">
                      {fmtEventTime(ev.timestamp ?? '')}
                    </span>
                  </div>
                  <Badge variant="neutral" className="shrink-0 text-2xs">
                    {fmtDuration(ev.duration_seconds ?? 0)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </WidgetShell>
    );
  }

  // ── Standard layout (2×4+) ──
  return (
    <WidgetShell
      title={t('widget.backupHistory.title', 'Backup History')}
      icon={<BatteryFull className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading}
      error={null}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {items.length === 0 && !isLoading ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BatteryFull className="h-5 w-5" />}
          message={t('widget.backupHistory.noEvents', 'No backup events in the last 30 days')}
          className="py-4"
        />
      ) : (
        <div className="flex flex-col gap-3 h-full">
          {/* Stat summary row */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <StatCard
              label={t('widget.backupHistory.outages30d', 'Outages (30d)')}
              value={fmtInt(totalOutages)}
            />
            <StatCard
              label={t('widget.backupHistory.avgDuration', 'Avg Duration')}
              value={fmtDuration(avgDurationSec)}
            />
          </div>

          {/* Event list */}
          <ul className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
            {sortedItems.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 min-h-[44px]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Zap aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--text-primary)] truncate">
                      {fmtEventTime(ev.timestamp ?? '')}
                    </p>
                    <p className="text-2xs text-[var(--text-muted)]">
                      {t('widget.backupHistory.duration', 'Duration')}: {fmtDuration(ev.duration_seconds ?? 0)}
                    </p>
                  </div>
                </div>
                <Badge variant="neutral" className="shrink-0">
                  {fmtDuration(ev.duration_seconds ?? 0)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetShell>
  );
}
