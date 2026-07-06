import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { StatusBadge } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useDashboardStats } from '@/api/hooks/useDashboard';
import { useVehicleStateMachine, useStateTimeline } from '@/api/hooks/useAdmin';
import { useVehicles } from '@/api/hooks/useVehicles';
import { formatRelative } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

export default function DashboardStatsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : '';

  const stats = useDashboardStats();
  const fsm = useVehicleStateMachine(idStr);
  const timeline = useStateTimeline(idStr);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const dashStats = stats.data;
  const fsmState = fsm.data?.state ?? '—';

  const statItems = useMemo<StatGridItem[]>(() => [
    {
      label: t('widget.dashboardStats.vehicles', 'Vehicles'),
      value: fmtInt(dashStats?.totalVehicles ?? 0),
    },
    {
      label: t('widget.dashboardStats.trips', 'Trips'),
      value: fmtInt(dashStats?.totalTrips ?? 0),
    },
    {
      label: t('widget.dashboardStats.sessions', 'Charge Sessions'),
      value: fmtInt(dashStats?.totalChargingSessions ?? 0),
    },
    {
      label: t('widget.dashboardStats.fsmState', 'FSM State'),
      value: fsmState,
    },
  ], [dashStats, fsmState, t]);

  const recentTransitions = useMemo(
    () => (isWide ? (timeline.data?.transitions ?? []).slice(0, 5) : []),
    [timeline.data, isWide],
  );

  /*
   * Freshness reflects the two live primary sources — the dashboard stats and
   * the FSM vehicle state. The state-transition timeline is a deprecated,
   * best-effort secondary whose endpoint is expected to 404 (see
   * useStateTimeline); its failure and background-refetch churn must NOT drive
   * the widget's health indicator. `isLoading` already excluded it — the other
   * signals are aligned here so a 404 timeline never paints a red/stale/fetching
   * freshness dot on top of otherwise-healthy stats.
   */
  const updatedAt = Math.max(stats.dataUpdatedAt ?? 0, fsm.dataUpdatedAt ?? 0);
  const isFetching = stats.isFetching || fsm.isFetching;
  const isStale = stats.isStale || fsm.isStale;
  const isError = stats.isError || fsm.isError;
  const isLoading = stats.isLoading || fsm.isLoading;

  const handleRefresh = useCallback(() => {
    stats.refetch();
    fsm.refetch();
    timeline.refetch();
  }, [stats.refetch, fsm.refetch, timeline.refetch]);

  const hasData = stats.data != null;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.dashboardStats.title', 'Dashboard Stats')}
      icon={isCompact ? undefined : <LayoutDashboard aria-hidden="true" className="h-3.5 w-3.5 text-indigo-400" />}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        <div className="flex flex-col gap-3 h-full">
          {isCompact ? (
            <div className="flex flex-col items-center justify-center h-full gap-1 min-h-[44px]">
              <span className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
                {fmtInt(dashStats?.totalTrips ?? 0)}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {t('widget.dashboardStats.active', 'active')}
              </span>
            </div>
          ) : (
            <>
              <WidgetStatGrid stats={statItems} compact={false} cols={2} />

              {/* FSM badge row */}
              <div className="flex items-center gap-2 min-h-[44px]">
                <span className="text-xs text-[var(--text-secondary)]">
                  {t('widget.dashboardStats.currentState', 'Current State')}
                </span>
                <StatusBadge status={fsmState} size="sm" />
              </div>
            </>
          )}

          {/* Wide: recent state transitions */}
          {isWide && recentTransitions.length > 0 && (
            <div className="space-y-1.5 overflow-y-auto">
              <span className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
                {t('widget.dashboardStats.recentTransitions', 'Recent Transitions')}
              </span>
              <div className="flex flex-col gap-1">
                {recentTransitions.map((tr, i) => (
                  <div
                    key={`${tr.state}-${tr.startedAt}-${i}`}
                    className="flex items-center justify-between min-h-[44px]"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="neutral" className="text-2xs capitalize truncate">
                        {tr.state ?? '—'}
                      </Badge>
                    </div>
                    <span className="text-xs text-[var(--text-secondary)] tabular-nums truncate">
                      {tr.startedAt
                        ? formatRelative(tr.startedAt)
                        : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<LayoutDashboard aria-hidden="true" className="h-5 w-5" />}
          message={t('widget.dashboardStats.noData', 'No dashboard stats available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
