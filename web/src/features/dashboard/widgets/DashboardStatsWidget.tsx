import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { StatusBadge } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDashboardStats } from '@/api/hooks/useDashboard';
import { useVehicleStateMachine } from '@/api/hooks/useAdmin';
import { useFSMTransitions } from '@/api/hooks/useFSM';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDateFormat } from '@/hooks/useDateFormat';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber, knownString } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { dashboardTokens } from '../lib/dashboardTokens';

export default function DashboardStatsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { formatRelative } = useDateFormat();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const id = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const idStr = Number.isSafeInteger(id) && Number(id) > 0 ? String(id) : '';

  const stats = useDashboardStats();
  const fsm = useVehicleStateMachine(idStr);
  const timeline = useFSMTransitions(idStr, 'vehicle', 168, 1, 5);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const dashStats = stats.data;
  // CurrentState returns a state envelope; older hook typings describe only
  // the inner state. Never pass the wire object into a status badge.
  const rawState: unknown = fsm.data?.state;
  const fsmState = idStr
    ? knownString(rawState) ?? (
      rawState != null && typeof rawState === 'object' && 'state' in rawState
        ? knownString(rawState.state)
        : null
    ) ?? '—'
    : '—';

  const statItems = useMemo<StatMetric[]>(() => [
    {
      metricId: 'count',
      label: t('widget.dashboardStats.vehicles', 'Vehicles'),
      rawValue: dashStats?.totalVehicles,
      description: t('widget.dashboardStats.summary.vehiclesHelp', 'Fleet vehicle total reported by the dashboard stats source.'),
    },
    {
      metricId: 'count',
      label: t('widget.dashboardStats.trips', 'Trips'),
      rawValue: dashStats?.totalTrips,
      description: t('widget.dashboardStats.summary.tripsHelp', 'Fleet trip total; not the selected vehicle’s recent transition count.'),
    },
    {
      metricId: 'count',
      label: t('widget.dashboardStats.sessions', 'Charge sessions'),
      rawValue: dashStats?.totalChargingSessions,
      description: t('widget.dashboardStats.summary.sessionsHelp', 'Fleet charging-session total reported by dashboard stats.'),
    },
    {
      metricId: 'status',
      label: t('widget.dashboardStats.fsmState', 'FSM state'),
      rawValue: fsmState === '—' ? null : fsmState,
      description: t('widget.dashboardStats.summary.fsmHelp', 'Current state for the resolved vehicle only, independently loaded from fleet totals.'),
    },
  ], [dashStats, fsmState, t]);

  const recentTransitions = useMemo(
    () => (isWide ? safeArray(timeline.data?.data).slice(0, 5) : []),
    [timeline.data, isWide],
  );

  // Historical transitions own their recovery state; an outage must not erase
  // the independently available fleet counts and current vehicle state.
  const isFetching = stats.isFetching || fsm.isFetching;
  const isStale = stats.isStale || fsm.isStale;
  const isError = stats.isError || fsm.isError;

  const handleRefresh = useCallback(() => {
    stats.refetch();
    if (idStr) {
      fsm.refetch();
      timeline.refetch();
    }
    if (vehicleId == null) void vehiclesQuery.refetch?.();
  }, [stats.refetch, fsm.refetch, timeline.refetch, idStr, vehicleId, vehiclesQuery.refetch]);

  const statsState = useDataState(stats);
  const fsmStateData = useDataState(fsm);
  const discoveryState = useDataState(vehiclesQuery);
  const timelineState = useDataState(timeline, { provenance: 'historical' });
  const states = [
    statsState,
    ...(idStr ? [fsmStateData] : vehicleId == null && !discoveryState.hasData ? [discoveryState] : []),
  ];
  if (idStr && vehicleId == null && (statsState.hasData || fsmStateData.hasData)) states.push(discoveryState);
  const dataState = {
    ...combineDataStates(states),
    data: { stats: stats.data, fsm: idStr ? fsm.data : undefined },
    hasData: states.some((state) => state.hasData),
    retry: handleRefresh,
  };
  const hasData = dataState.hasData && (stats.data != null || (idStr && fsm.data != null));

  return (
    <WidgetShell
      title={t('widget.dashboardStats.title', 'Dashboard stats')}
      icon={isCompact ? undefined : <LayoutDashboard aria-hidden="true" className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={dataState}
      updatedAt={dataState.updatedAt ?? 0}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        <div className="flex flex-col gap-3 h-full">
          {isCompact ? (
            <WidgetBigNumber
              value={knownNumber(dashStats?.totalTrips) == null ? null : fmtInt(dashStats?.totalTrips)}
              label={t('widget.dashboardStats.trips', 'Trips')}
              align="center"
            />
          ) : (
            <>
              <DashboardSourceBrief
                metrics={statItems}
                state={dataState}
                eyebrow={t('widget.dashboardStats.summary.eyebrow', 'Dashboard sources')}
                title={t('widget.dashboardStats.summary.title', 'Fleet counts and vehicle state')}
                description={t('widget.dashboardStats.summary.description', 'Fleet-wide totals and the resolved vehicle’s current FSM state are independent sources. Aggregate bounds are not supplied; the wide view’s latest five transitions come from a separate 168-hour history query.')}
                scope={idStr
                  ? t('widget.dashboardStats.summary.scope', 'Fleet counts · FSM vehicle {{id}}', { id: idStr })
                  : t('widget.dashboardStats.summary.noScope', 'Fleet counts · no resolved FSM vehicle')}
                testId="dashboard-stats-operational-brief"
              />

              {/* FSM badge row */}
              <div className="flex items-center gap-2 min-h-[44px]">
                <span className="text-xs text-[var(--text-secondary)]">
                  {t('widget.dashboardStats.currentState', 'Current state')}
                </span>
                <StatusBadge status={fsmState} size="sm" />
              </div>
            </>
          )}

          {/* Wide: recent state transitions */}
          {isWide && (
            <div className="space-y-1.5 overflow-y-auto">
              <span className={dashboardTokens.metricLabel}>
                {t('widget.dashboardStats.recentTransitions', 'Recent transitions')}
              </span>
              {idStr && <StaleRefreshWarning state={timelineState} />}
              {idStr && timelineState.fatalError ? (
                <QueryError error={timelineState.fatalError} onRetry={timelineState.retry ?? undefined} />
              ) : idStr && timelineState.status === 'initial' ? (
                <Skeleton className="h-16 rounded-lg" />
              ) : recentTransitions.length === 0 ? (
                <EmptyState
                  message={t('common.noData', 'No data available')}
                  action={idStr ? { label: t('common.refresh', 'Refresh'), onClick: () => { void timeline.refetch(); } } : undefined}
                  actionTo={!idStr ? { label: t('nav.vehicles', 'Fleet'), to: '/vehicles' } : undefined}
                />
              ) : null}
              <div className="flex flex-col gap-1">
                {recentTransitions.map((tr, i) => (
                  <div
                    key={`${tr.id}-${tr.ts}-${i}`}
                    className="flex items-center justify-between min-h-[44px]"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="neutral" className="text-2xs truncate">
                        {tr.to_state ?? '—'}
                      </Badge>
                    </div>
                    <span className="text-xs text-[var(--text-secondary)] tabular-nums truncate">
                      {tr.ts
                        ? formatRelative(tr.ts)
                        : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<LayoutDashboard aria-hidden="true" className="h-5 w-5" />}
          message={t('widget.dashboardStats.noData', 'No dashboard stats available')}
          className="py-4"
          action={{ label: t('common.refresh', 'Refresh'), onClick: handleRefresh }}
          actionTo={!idStr ? { label: t('nav.vehicles', 'Fleet'), to: '/vehicles' } : undefined}
        />
      )}
    </WidgetShell>
  );
}
