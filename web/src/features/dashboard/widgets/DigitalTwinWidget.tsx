import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Monitor, Lock, Unlock, ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { VehicleTwin } from '@/components/vehicles';
import { useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { buildTwinState } from '@/lib/vehicleState';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const REFRESH_INTERVAL = 5_000;

export default function DigitalTwinWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];
  const id = vehicle?.id ?? 0;
  const { data: stateData, isLoading: stateLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id, { refetchInterval: REFRESH_INTERVAL });
  const { data: security, isLoading: securityLoading } = useSecurityLatest(id, REFRESH_INTERVAL);
  const { data: charging } = useChargingTelemetryLatest(id, REFRESH_INTERVAL);
  const state = stateData?.state;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const twinState = useMemo(
    () => buildTwinState(security, state, charging),
    [security, state, charging],
  );

  const windowStates = [twinState.windowFD, twinState.windowFP, twinState.windowRD, twinState.windowRP];
  const hasWindowData = windowStates.some((windowState) => windowState !== null);
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
    ? t('widget.lockUnknown', 'Lock Unknown')
    : twinState.locked
      ? t('widget.locked', 'Locked')
      : t('widget.unlocked', 'Unlocked');
  const windowBadgeVariant = !hasWindowData ? 'neutral' : openWindowCount === 0 ? 'success' : 'warning';
  const windowLabel = !hasWindowData
    ? t('widget.windowsUnknown', 'Windows Unknown')
    : openWindowCount === 0
      ? t('widget.windowsClosed', 'Windows Closed')
      : `${openWindowCount} ${t('widget.windowsOpen', 'Open')}`;

  return (
    <WidgetShell
      title={t('widget.digitalTwin', 'Digital Twin')}
      icon={<Monitor className="h-3.5 w-3.5 text-neon-purple" />}
      loading={vehiclesLoading || stateLoading || securityLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
      actions={
        <Link
          to="/digital-twin"
          className="text-2xs text-[var(--text-muted)] hover:text-cyan-300 transition-colors flex items-center gap-0.5"
        >
          {t('widget.open', 'Open')} <ArrowUpRight className="h-3 w-3" />
        </Link>
      }
    >
      {vehicle ? (
        <div className="h-full min-h-0 flex flex-col items-center justify-center gap-3">
          <div className="relative flex-1 min-h-[170px] w-full flex items-center justify-center overflow-hidden">
            <div className="absolute inset-x-8 bottom-2 h-16 rounded-full bg-neon-purple/10 blur-2xl" />
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
                {t('widget.headlightsOn', 'Lights On')}
              </Badge>
            ) : null}
            {twinState.hazards ? (
              <Badge variant="warning" dot>
                {t('widget.hazardsOn', 'Hazards')}
              </Badge>
            ) : null}
            {openDoorCount > 0 ? (
              <Badge variant="warning">
                {openDoorCount} {t('widget.doorsOpen', 'Doors Open')}
              </Badge>
            ) : null}
            {twinState.frunkOpen ? (
              <Badge variant="warning">
                {t('widget.frunkOpen', 'Frunk Open')}
              </Badge>
            ) : null}
            {twinState.trunkOpen ? (
              <Badge variant="warning">
                {t('widget.trunkOpen', 'Trunk Open')}
              </Badge>
            ) : null}
          </div>

          <p className="flex-shrink-0 text-xs text-[var(--text-muted)]">
            {vehicle.display_name || vehicle.vin || t('widget.unknownVehicle', 'Unknown vehicle')}
          </p>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Monitor className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
