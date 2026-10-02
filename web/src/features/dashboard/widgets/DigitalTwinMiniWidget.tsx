import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Monitor, ArrowUpRight, Lock, Unlock, Shield } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { VehicleTwin } from '@/components/vehicles';
import { useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { buildTwinState } from '@/lib/vehicleState';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { WidgetStatusGrid } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const REFRESH_INTERVAL = 5_000;

export default function DigitalTwinMiniWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const { data: vehicles, isLoading: vehiclesLoading } = vehiclesQuery;
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];
  const id = vehicle?.id ?? 0;

  const securityQuery = useSecurityLatest(id, REFRESH_INTERVAL);
  const stateQuery = useVehicleState(id, { refetchInterval: REFRESH_INTERVAL });
  const chargingQuery = useChargingTelemetryLatest(id, REFRESH_INTERVAL);
  const { data: securityData, isLoading: secLoading } = securityQuery;
  const { data: vehicleStateData, isLoading: stateLoading, isFetching: stateFetching, isStale: stateStale, isError: stateError, dataUpdatedAt: stateUpdatedAt, refetch: refetchState } = stateQuery;
  const { data: chargingData } = chargingQuery;

  // Include the vehicle-list load so the shell shows a skeleton during the
  // initial fetch instead of flashing the "No vehicle data" empty state.
  const isLoading = vehiclesLoading || secLoading || stateLoading;
  const vehicleState = vehicleStateData?.state ?? null;
  const stateTrust = useDataState({ ...stateQuery, data: vehicleStateData ?? (stateLoading || stateError ? undefined : null) }, { provenance: vehicleStateData?.live ? 'live' : 'cached' });
  const securityTrust = useDataState({ ...securityQuery, data: securityData ?? (secLoading || securityQuery.isError ? undefined : null) }, { provenance: 'cached' });
  const chargingTrust = useDataState({ ...chargingQuery, data: chargingData ?? (chargingQuery.isLoading || chargingQuery.isError ? undefined : null) }, { provenance: 'cached' });
  const vehiclesTrust = useDataState({ ...vehiclesQuery, data: vehicles ?? (vehiclesLoading || vehiclesQuery.isError ? undefined : []) });
  const combined = combineDataStates(vehicle ? [stateTrust, securityTrust, chargingTrust] : [vehiclesTrust]);
  const hasTelemetry = vehicleStateData != null || securityData != null || chargingData != null;
  const dataState = {
    ...combined,
    status: !hasTelemetry && isLoading ? 'initial' : combined.status,
    data: vehicle ? [vehicleStateData, securityData, chargingData] : vehicles,
    hasData: hasTelemetry,
    retry: () => { void refetchState(); void securityQuery.refetch?.(); void chargingQuery.refetch?.(); void vehiclesQuery.refetch?.(); },
  } satisfies Parameters<typeof WidgetShell>[0]['dataState'];

  const twinState = useMemo(
    () => buildTwinState(securityData, vehicleState, chargingData),
    [securityData, vehicleState, chargingData],
  );

  const isCompact = size.cols <= 2 && size.rows <= 2;

  return (
    <WidgetShell
      title={t('widget.digitalTwinMini', 'Digital twin')}
      icon={<Monitor className="h-3.5 w-3.5" />}
      dataState={dataState}
      loadingContent={<div className="flex flex-col gap-2"><Skeleton className="h-28" /><Skeleton className="h-11" /></div>}
      loading={isLoading}
      updatedAt={combined.updatedAt ?? stateUpdatedAt}
      isFetching={combined.isRefreshing || stateFetching}
      isStale={stateStale}
      isError={stateError}
      onRefresh={() => { void refetchState(); void securityQuery.refetch?.(); void chargingQuery.refetch?.(); }}
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
        <div className="h-full flex flex-col items-center justify-center gap-2 px-2 pb-2">
          <div className="flex-1 min-h-0 flex items-center justify-center w-full">
            <VehicleTwin
              {...twinState}
              size="sm"
              vehicleId={vehicle?.id}
              exteriorColor={vehicle?.exterior_color}
              model={vehicle?.model}
            />
          </div>

          {/* Status badges — shown unless very cramped */}
          {!isCompact || size.rows >= 2 ? (
            <div className="flex-shrink-0 flex flex-wrap gap-1.5 justify-center">
              <Badge
                variant={
                  // Unknown lock state stays neutral — a green "success" chip
                  // here would falsely signal a secured vehicle.
                  twinState.locked === false ? 'danger' : twinState.locked ? 'success' : 'neutral'
                }
              >
                {twinState.locked === false ? (
                  <Unlock className="h-2.5 w-2.5 mr-0.5" />
                ) : (
                  <Lock className="h-2.5 w-2.5 mr-0.5" />
                )}
                {twinState.locked === false
                  ? t('widget.unlocked', 'Unlocked')
                  : twinState.locked
                    ? t('widget.locked', 'Locked')
                    : '—'}
              </Badge>
              {twinState.sentryMode != null && (
                <Badge variant={twinState.sentryMode ? 'info' : 'neutral'}>
                  <Shield className="h-2.5 w-2.5 mr-0.5" />
                  {twinState.sentryMode
                    ? t('widget.sentryOn', 'Sentry')
                    : t('widget.sentryOff', 'Off')}
                </Badge>
              )}
            </div>
          ) : null}
          {!isCompact && <WidgetStatusGrid compact cells={[
            {
              id: 'sentry', label: t('widget.sentryOn', 'Sentry'),
              status: twinState.sentryMode == null ? 'unknown' : twinState.sentryMode ? 'ok' : 'inactive',
              statusLabel: twinState.sentryMode == null ? t('widget.status.unknown', 'Unknown') : twinState.sentryMode ? t('widget.sentryOn', 'Sentry') : t('widget.sentryOff', 'Off'),
            },
          ]} />}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Monitor className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
        <WidgetStatusGrid compact cells={[
          { id: 'lock', label: t('widget.lockStatus', 'Lock'), status: 'unknown' },
        ]} />
        </div>
      )}
    </WidgetShell>
  );
}
