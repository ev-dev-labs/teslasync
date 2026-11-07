import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Lock, Unlock, ArrowUpRight } from 'lucide-react';
import { Badge, Caption, IconButton, MetricValue, Text } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { buildTwinState } from '@/lib/vehicleState';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { WidgetStatusGrid } from './shared';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';
import { sourceBoundaryState } from '../components/continuation-dashboard-1/sourceBoundary';
import VehicleStudio from './vehicle-instruments/VehicleStudio';
import { useVerifiedDriving } from './vehicle-instruments/useVerifiedDriving';
import { useVerifiedStudioLights } from './vehicle-instruments/useVerifiedStudioLights';

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
  const driving = useVerifiedDriving(stateData, isError);
  const lightsOn = useVerifiedStudioLights(id, securityQuery);
  const stateTrust = useDataState({ ...stateQuery, data: stateData ?? (stateLoading || isError ? undefined : null) }, { provenance: stateData?.live ? 'live' : 'cached' });
  const securityTrust = useDataState({ ...securityQuery, data: security ?? (securityLoading || securityQuery.isError ? undefined : null) }, { provenance: 'cached' });
  const chargingTrust = useDataState({ ...chargingQuery, data: charging ?? (chargingQuery.isLoading || chargingQuery.isError ? undefined : null) }, { provenance: 'cached' });
  const vehiclesTrust = useDataState({ ...vehiclesQuery, data: vehicles ?? (vehiclesLoading || vehiclesQuery.isError ? undefined : []) });
  const hasTelemetry = stateData != null || security != null || charging != null;
  // Vehicle metadata must not mask an initial failure of every telemetry source.
  const combined = combineDataStates(vehicle
    ? hasTelemetry ? [stateTrust, securityTrust, chargingTrust, vehiclesTrust] : [stateTrust, securityTrust, chargingTrust]
    : [vehiclesTrust]);
  const handleRefresh = useCallback(() => {
    void refetch();
    void securityQuery.refetch?.();
    void chargingQuery.refetch?.();
    void vehiclesQuery.refetch?.();
  }, [refetch, securityQuery, chargingQuery, vehiclesQuery]);

  const dataState = {
    ...combined,
    status: !hasTelemetry && (vehiclesLoading || stateLoading || securityLoading) ? 'initial' : combined.status,
    data: vehicle ? [stateData, security, charging] : vehicles,
    hasData: hasTelemetry,
    retry: handleRefresh,
  } satisfies Parameters<typeof WidgetShell>[0]['dataState'];

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
  const isCompact = size.rows <= 4;

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

  const vehicleName = vehicle?.display_name || vehicle?.vin || t('widget.unknownVehicle', 'Unknown vehicle');
  const unknownLabel = t('widget.status.unknown', 'Unknown');
  const scene = vehicle ? (
          <div className="relative shrink-0 w-full flex items-center justify-center
            [[data-widget-appearance=expressive]_&]:rounded-3xl
            [[data-widget-appearance=expressive]_&]:bg-[var(--surface-2)]
            [[data-widget-appearance=expressive]_&]:p-3">
            <VehicleStudio
              twinState={twinState}
              vehicle={vehicle}
              driving={driving}
              lightsOn={lightsOn}
              size={twinSize}
              bounded={isCompact}
            />
          </div>
  ) : null;
  const badges = (
          <div className="flex w-full flex-shrink-0 flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-2">
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
  );
  const accessStatus = (
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
  );
  const sourceWarnings = [
            { id: 'state', label: t('widget.digitalTwinSources.state', 'Vehicle state'), trust: stateTrust, hasContent: stateData != null, retry: () => { void refetch(); } },
            { id: 'security', label: t('widget.digitalTwinSources.security', 'Security state'), trust: securityTrust, hasContent: security != null, retry: () => { void securityQuery.refetch(); } },
            { id: 'charging', label: t('widget.digitalTwinSources.charging', 'Charging state'), trust: chargingTrust, hasContent: charging != null, retry: () => { void chargingQuery.refetch(); } },
          ].filter(source => !source.hasContent || source.trust.refreshError || source.trust.isRefreshBlocked).map(source => (
            <div key={source.id} className="w-full min-w-0">
              <SourceContent
                state={sourceBoundaryState(source.trust, source.hasContent)}
                label={source.label}
                emptyMessage={t('widget.digitalTwinSources.unavailable', '{{source}} unavailable', { source: source.label })}
                errorMessage={t('widget.digitalTwinSources.unavailable', '{{source}} unavailable', { source: source.label })}
                error={source.trust.fatalError}
                retainedMessage={t('widget.digitalTwinSources.retained', '{{source}}: previously loaded data remains visible while this source recovers.', { source: source.label })}
                errorRecovery={{ onRetry: source.retry }}
              >
                {null}
              </SourceContent>
            </div>
          ));
  const empty = (
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
  );
  const details = (
    <div className="flex min-w-0 flex-col gap-3">
      {accessStatus}
      <KVList layout="responsive" items={[
        {
          id: 'charge-port', label: t('dashboardWidgets.vehicle.digitalTwinDetails.chargePort', 'Charge port'),
          // Active charging alone does not establish a reported port-door position.
          value: charging?.charge_port_door_open == null ? unknownLabel
            : charging.charge_port_door_open ? t('widget.open', 'Open')
              : t('dashboardWidgets.vehicle.digitalTwinDetails.closed', 'Closed'),
        },
        { id: 'lock', label: t('widget.lockStatus', 'Lock'), value: lockLabel },
        {
          id: 'sentry', label: t('widget.sentryOn', 'Sentry'),
          value: twinState.sentryMode == null ? unknownLabel
            : twinState.sentryMode ? t('widget.active', 'Active') : t('widget.off', 'Off'),
        },
        {
          id: 'state', label: t('widget.digitalTwinSources.state', 'Vehicle state'),
          value: twinState.isDriving ? t('widget.driving', 'Driving') : state?.state?.trim() || unknownLabel,
        },
        {
          id: 'charging', label: t('widget.digitalTwinSources.charging', 'Charging state'),
          value: twinState.isCharging ? t('widget.charging', 'Charging')
            : charging?.charging_state?.trim() || (state?.is_charging === false ? t('widget.notCharging', 'Not charging') : unknownLabel),
        },
      ]} />
      {sourceWarnings}
    </div>
  );

  return (
    <WidgetShell
      title={t('widget.digitalTwin', 'Digital twin')}
      icon={<Monitor className="h-3.5 w-3.5" />}
      dataState={dataState}
      loadingContent={<div className="flex flex-col gap-3"><Skeleton className="h-40" /><Skeleton className="h-11" /></div>}
      loading={vehiclesLoading || stateLoading || securityLoading}
      updatedAt={combined.updatedAt ?? dataUpdatedAt}
      refreshIntervalMs={REFRESH_INTERVAL}
      isFetching={combined.isRefreshing || isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
      actions={
        <IconButton href="/digital-twin" icon={<ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
          label={t('widget.open', 'Open')} aria-label={t('widget.open', 'Open')} />
      }
    >
      <InstrumentPresentation family="twin" compact={isCompact}
        icon={vehicle ? <Monitor /> : undefined}
        headline={vehicle ? <div className="min-w-0 space-y-1">
          <Caption>{t('dashboardWidgets.vehicle.digitalTwinDetails.interactive', 'Interactive digital twin')}</Caption>
          <MetricValue className="[overflow-wrap:anywhere]">{vehicleName}</MetricValue>
        </div> : undefined}
        context={vehicle ? badges : undefined}
        instrument={vehicle ? scene : empty}
        details={vehicle ? details : undefined}
      >
        {vehicle ? (
          <div className="h-full min-h-0 flex flex-col items-center gap-3">
            {/* Keep intrinsic scene height measurable for grid auto-fit. */}
            {scene}
            {badges}
            {accessStatus}
            <Text as="p" variant="bodySm" className="shrink-0 text-center max-w-full [overflow-wrap:anywhere]">
              {vehicleName}
            </Text>
            {sourceWarnings}
          </div>
        ) : empty}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
