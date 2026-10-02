import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Monitor, Lock, Unlock, ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { VehicleTwin } from '@/components/vehicles';
import { useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { buildTwinState } from '@/lib/vehicleState';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { WidgetStatusGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const REFRESH_INTERVAL = 5_000;

export default function DigitalTwinWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const { data: vehicles, isLoading: vehiclesLoading } = vehiclesQuery;
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];
  const id = vehicle?.id ?? 0;
  const stateQuery = useVehicleState(id, { refetchInterval: REFRESH_INTERVAL });
  const securityQuery = useSecurityLatest(id, REFRESH_INTERVAL);
  const chargingQuery = useChargingTelemetryLatest(id, REFRESH_INTERVAL);
  const { data: stateData, isLoading: stateLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = stateQuery;
  const { data: security, isLoading: securityLoading } = securityQuery;
  const { data: charging } = chargingQuery;
  const state = stateData?.state;
  const stateTrust = useDataState({ ...stateQuery, data: stateData ?? (stateLoading || isError ? undefined : null) }, { provenance: stateData?.live ? 'live' : 'cached' });
  const securityTrust = useDataState({ ...securityQuery, data: security ?? (securityLoading || securityQuery.isError ? undefined : null) }, { provenance: 'cached' });
  const chargingTrust = useDataState({ ...chargingQuery, data: charging ?? (chargingQuery.isLoading || chargingQuery.isError ? undefined : null) }, { provenance: 'cached' });
  const vehiclesTrust = useDataState({ ...vehiclesQuery, data: vehicles ?? (vehiclesLoading || vehiclesQuery.isError ? undefined : []) });
  const combined = combineDataStates(vehicle ? [stateTrust, securityTrust, chargingTrust] : [vehiclesTrust]);
  const hasTelemetry = stateData != null || security != null || charging != null;
  const dataState = {
    ...combined,
    status: !hasTelemetry && (vehiclesLoading || stateLoading || securityLoading) ? 'initial' : combined.status,
    data: vehicle ? [stateData, security, charging] : vehicles,
    hasData: hasTelemetry,
    retry: () => { void refetch(); void securityQuery.refetch?.(); void chargingQuery.refetch?.(); void vehiclesQuery.refetch?.(); },
  } satisfies Parameters<typeof WidgetShell>[0]['dataState'];

  const handleRefresh = useCallback(() => {
    refetch();
    void securityQuery.refetch?.();
    void chargingQuery.refetch?.();
  }, [refetch, securityQuery, chargingQuery]);

  const twinState = useMemo(
    () => buildTwinState(security, state, charging),
    [security, state, charging],
  );

  const windowStates = [twinState.windowFD, twinState.windowFP, twinState.windowRD, twinState.windowRP];
  const hasWindowData = windowStates.every((windowState) => windowState !== null);
  const openWindowCount = windowStates.filter((windowState) => windowState !== null && windowState !== 'closed').length;
  const sideDoorStates = [
    twinState.doors.driverFront,
    twinState.doors.passengerFront,
    twinState.doors.driverRear,
    twinState.doors.passengerRear,
  ];
  const openDoorCount = sideDoorStates.filter(Boolean).length;
  const twinSize = size.cols >= 3 || size.rows >= 5 ? 'md' : 'sm';

  const lockBadgeVariant = twinState.locked === null ? 'neutral' : twinState.locked ? 'success' : 'danger';
  const lockLabel = twinState.locked === null
    ? t('widget.lockUnknown', 'Lock unknown')
    : twinState.locked
      ? t('widget.locked', 'Locked')
      : t('widget.unlocked', 'Unlocked');
  const windowBadgeVariant = openWindowCount > 0 ? 'warning' : !hasWindowData ? 'neutral' : 'success';
  const windowLabel = openWindowCount > 0 ? `${openWindowCount} ${t('widget.windowsOpen', 'Open')}` : !hasWindowData
    ? t('widget.windowsUnknown', 'Windows unknown')
    : openWindowCount === 0
      ? t('widget.windowsClosed', 'Windows closed')
      : `${openWindowCount} ${t('widget.windowsOpen', 'Open')}`;

  return (
    <WidgetShell
      title={t('widget.digitalTwin', 'Digital twin')}
      icon={<Monitor className="h-3.5 w-3.5" />}
      dataState={dataState}
      loadingContent={<div className="flex flex-col gap-3"><Skeleton className="h-40" /><Skeleton className="h-11" /></div>}
      loading={vehiclesLoading || stateLoading || securityLoading}
      updatedAt={combined.updatedAt ?? dataUpdatedAt}
      isFetching={combined.isRefreshing || isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
      actions={
        <Link
          to="/digital-twin"
          className="flex min-h-11 items-center gap-1 rounded-shape-sm px-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {t('widget.open', 'Open')} <ArrowUpRight className="h-3 w-3" />
        </Link>
      }
    >
      {vehicle ? (
        <div className="h-full min-h-0 flex flex-col items-center justify-center gap-3">
          <div className="relative flex-1 min-h-[170px] w-full flex items-center justify-center">
            <VehicleTwin
              {...twinState}
              size={twinSize}
              vehicleId={vehicle?.id}
              exteriorColor={vehicle?.exterior_color}
              model={vehicle?.model}
              driveIn
              className="relative z-10 drop-shadow-2xl"
            />
          </div>

          <div className="flex flex-shrink-0 flex-wrap gap-1.5 justify-center">
            <Badge variant={lockBadgeVariant}>
              {twinState.locked === false ? (
                <Unlock className="h-2.5 w-2.5 mr-0.5" />
              ) : (
                <Lock className="h-2.5 w-2.5 mr-0.5" />
              )}
              {lockLabel}
            </Badge>
            <Badge variant={windowBadgeVariant}>
              {windowLabel}
            </Badge>
            {twinState.isDriving ? (
              <Badge variant="info" dot>
                {t('widget.driving', 'Driving')}
              </Badge>
            ) : null}
            {twinState.isCharging ? (
              <Badge variant="info" dot>
                {t('widget.charging', 'Charging')}
              </Badge>
            ) : null}
            {twinState.sentryMode ? (
              <Badge variant="warning" dot>
                {t('widget.sentryOn', 'Sentry')}
              </Badge>
            ) : null}
            {twinState.headlights ? (
              <Badge variant="neutral" dot>
                {t('widget.headlightsOn', 'Lights on')}
              </Badge>
            ) : null}
            {twinState.hazards ? (
              <Badge variant="warning" dot>
                {t('widget.hazardsOn', 'Hazards')}
              </Badge>
            ) : null}
            {openDoorCount > 0 ? (
              <Badge variant="warning">
                {openDoorCount} {t('widget.doorsOpen', 'Doors open')}
              </Badge>
            ) : null}
            {twinState.frunkOpen ? (
              <Badge variant="warning">
                {t('widget.frunkOpen', 'Frunk open')}
              </Badge>
            ) : null}
            {twinState.trunkOpen ? (
              <Badge variant="warning">
                {t('widget.trunkOpen', 'Trunk open')}
              </Badge>
            ) : null}
          </div>

          <WidgetStatusGrid cols={2} cells={[
            {
              id: 'doors', label: t('widget.doorsOpen', 'Doors open'),
              status: openDoorCount > 0 ? 'warning' : sideDoorStates.every((value) => value !== null) ? 'inactive' : 'unknown',
              value: sideDoorStates.every((value) => value !== null) || openDoorCount > 0 ? String(openDoorCount) : '—',
              statusLabel: sideDoorStates.every((value) => value !== null) ? t('widget.reported', 'Reported') : t('widget.status.unknown', 'Unknown'),
            },
            {
              id: 'windows', label: t('widget.digitalTwinWindows', 'Windows'),
              status: openWindowCount > 0 ? 'warning' : hasWindowData ? 'inactive' : 'unknown',
              statusLabel: hasWindowData ? t('widget.reported', 'Reported') : t('widget.status.unknown', 'Unknown'),
            },
          ]} />
          <p className={`${dashboardTokens.metricLabel} flex-shrink-0 text-center`}>
            {vehicle.display_name || vehicle.vin || t('widget.unknownVehicle', 'Unknown vehicle')}
          </p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Monitor className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
        <WidgetStatusGrid cells={[
          { id: 'lock', label: t('widget.lockStatus', 'Lock'), status: 'unknown' },
          { id: 'windows', label: t('widget.windowsUnknown', 'Windows unknown'), status: 'unknown' },
        ]} />
        </div>
      )}
    </WidgetShell>
  );
}
