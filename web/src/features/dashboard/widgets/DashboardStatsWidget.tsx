import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicleStateMachine } from '@/api/hooks/useAdmin';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDashboardLayouts, type DashboardLayoutsPayload } from '@/api/hooks/useSettings';
import { combineDataStates } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { safeArray } from '@/lib/safeArray';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

export default function DashboardStatsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const id = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const idStr = Number.isSafeInteger(id) && Number(id) > 0 ? String(id) : '';

  const layouts = useDashboardLayouts();
  const fsm = useVehicleStateMachine(idStr);
  const isCompact = size.cols <= 1;

  const layoutData = layouts.data as DashboardLayoutsPayload | undefined;
  const dashboards = Array.isArray(layoutData?.dashboards) ? layoutData.dashboards : [];
  const activeDashboard = dashboards.find((dashboard) => {
    if (dashboard == null || typeof dashboard !== 'object') return false;
    return (dashboard as { id?: unknown }).id === layoutData?.active_id;
  }) as { widgets?: unknown } | undefined;
  const activeWidgets = Array.isArray(activeDashboard?.widgets) ? activeDashboard.widgets : null;
  const widgetsPlaced = activeWidgets?.length ?? null;
  const dashboardCount = dashboards.length > 0 ? dashboards.length : null;

  const rawState: unknown = fsm.data?.state;
  const carState = knownVehicleState(rawState, idStr);

  const statItems: StatGridItem[] = [
    {
      label: t('widget.dashboardStats.widgetsPlaced', 'Widgets placed'),
      value: widgetsPlaced == null ? null : fmtInt(widgetsPlaced),
    },
    {
      label: t('widget.dashboardStats.dashboards', 'Dashboards'),
      value: dashboardCount == null ? null : fmtInt(dashboardCount),
    },
    {
      label: t('widget.dashboardStats.carState', 'Car state'),
      value: carState,
    },
  ];

  const handleRefresh = useCallback(() => {
    void layouts.refetch();
    if (idStr) void fsm.refetch();
    if (vehicleId == null) void vehiclesQuery.refetch?.();
  }, [fsm, idStr, layouts, vehicleId, vehiclesQuery]);

  const layoutsState = useDataState(layouts);
  const fsmState = useDataState(fsm);
  const discoveryState = useDataState(vehiclesQuery);
  const states = [
    layoutsState,
    ...(idStr
      ? [fsmState]
      : vehicleId == null && !discoveryState.hasData
        ? [discoveryState]
        : []),
  ];
  if (idStr && vehicleId == null && (layoutsState.hasData || fsmState.hasData)) {
    states.push(discoveryState);
  }

  const dataState = {
    ...combineDataStates(states),
    data: { layouts: layouts.data, fsm: idStr ? fsm.data : undefined },
    hasData: states.some((state) => state.hasData),
    retry: handleRefresh,
  };
  const hasData = layoutData != null || (idStr && fsm.data != null);
  const isFetching = layouts.isFetching || fsm.isFetching;
  const isStale = layouts.isStale || fsm.isStale;
  const isError = layouts.isError || fsm.isError;

  return (
    <WidgetShell
      title={t('widget.dashboardStats.title', 'Dashboard stats')}
      icon={isCompact ? undefined : <LayoutDashboard aria-hidden="true" className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={dataState}
      updatedAt={Math.max(layouts.dataUpdatedAt ?? 0, fsm.dataUpdatedAt ?? 0)}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        isCompact ? (
          <WidgetBigNumber
            value={widgetsPlaced == null ? null : fmtInt(widgetsPlaced)}
            label={t('widget.dashboardStats.widgetsPlaced', 'Widgets placed')}
            align="center"
          />
        ) : (
          <WidgetStatGrid
            stats={statItems}
            cols={size.cols >= 3 ? 3 : 2}
            maxPerRow={3}
          />
        )
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

function knownVehicleState(value: unknown, vehicleId: string): string | null {
  if (!vehicleId) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (value != null && typeof value === 'object' && 'state' in value) {
    const nested = (value as { state?: unknown }).state;
    if (typeof nested === 'string') return nested.trim() || null;
  }
  return null;
}
