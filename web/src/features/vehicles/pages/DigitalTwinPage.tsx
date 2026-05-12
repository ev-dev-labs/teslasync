import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { KVList, StatusBadge } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { VehicleTwin, VehiclePaintPicker } from '@/components/vehicles';
import { VehicleSelect } from '@/components/forms';
import { buildTwinState, parseWindowState } from '@/lib/vehicleState';
import { deriveVehicleStatus } from '@/api/types';
import type { VehicleStatus } from '@/api/types';
import { Info, Car } from 'lucide-react';

const REFRESH_INTERVAL = 5_000;

function windowLabel(state: ReturnType<typeof parseWindowState>): string {
  switch (state) {
    case 'open': return 'Open';
    case 'closed': return 'Closed';
    case 'partial': return 'Partial';
    default: return '—';
  }
}

export default function DigitalTwinPage() {
  const { t } = useTranslation();
  usePageTitle(t('digitalTwin.title', 'Digital Twin'));

  const { vehicle } = useSelectedVehicle();
  const { isLoading: vehiclesLoading } = useVehicles();
  const vehicleId = vehicle?.id ?? 0;

  const { data: securityData } = useSecurityLatest(vehicleId, REFRESH_INTERVAL);
  const { data: vehicleStateData } = useVehicleState(vehicleId, { refetchInterval: REFRESH_INTERVAL });
  const { data: chargingData } = useChargingTelemetryLatest(vehicleId, REFRESH_INTERVAL);

  const vehicleState = vehicleStateData?.state ?? null;
  const twinState = useMemo(
    () => buildTwinState(securityData, vehicleState, chargingData),
    [securityData, vehicleState, chargingData],
  );

  // Derive a single source-of-truth status for the badge. The previous
  // logic only recognized the literal strings 'online' / 'asleep' from
  // /vehicles/{id}/state and silently fell through to 'offline' for
  // everything else — including the very common cases where the vehicle
  // was actually driving or charging, or where the state endpoint had
  // not yet hydrated but security/charging streams were already flowing.
  const badgeStatus = useMemo<VehicleStatus>(() => {
    if (twinState.isCharging) return 'charging';
    if (twinState.isDriving) return 'driving';
    const fromState = deriveVehicleStatus(vehicleState);
    if (fromState !== 'offline') return fromState;
    if (vehicleStateData?.live || securityData || chargingData) return 'online';
    return 'offline';
  }, [twinState.isCharging, twinState.isDriving, vehicleState, vehicleStateData?.live, securityData, chargingData]);

  const doorItems = useMemo(() => [
    { label: t('digitalTwin.doorDriverFront', 'Driver Front'), value: twinState.doors.driverFront === null ? '—' : twinState.doors.driverFront ? t('common.open', 'Open') : t('common.closed', 'Closed') },
    { label: t('digitalTwin.doorPassengerFront', 'Passenger Front'), value: twinState.doors.passengerFront === null ? '—' : twinState.doors.passengerFront ? t('common.open', 'Open') : t('common.closed', 'Closed') },
    { label: t('digitalTwin.doorDriverRear', 'Driver Rear'), value: twinState.doors.driverRear === null ? '—' : twinState.doors.driverRear ? t('common.open', 'Open') : t('common.closed', 'Closed') },
    { label: t('digitalTwin.doorPassengerRear', 'Passenger Rear'), value: twinState.doors.passengerRear === null ? '—' : twinState.doors.passengerRear ? t('common.open', 'Open') : t('common.closed', 'Closed') },
    { label: t('digitalTwin.frunk', 'Frunk'), value: twinState.frunkOpen === null ? '—' : twinState.frunkOpen ? t('common.open', 'Open') : t('common.closed', 'Closed') },
    { label: t('digitalTwin.trunk', 'Trunk'), value: twinState.trunkOpen === null ? '—' : twinState.trunkOpen ? t('common.open', 'Open') : t('common.closed', 'Closed') },
  ], [twinState, t]);

  const windowItems = useMemo(() => [
    { label: t('digitalTwin.windowFD', 'Front Driver'), value: windowLabel(twinState.windowFD) },
    { label: t('digitalTwin.windowFP', 'Front Passenger'), value: windowLabel(twinState.windowFP) },
    { label: t('digitalTwin.windowRD', 'Rear Driver'), value: windowLabel(twinState.windowRD) },
    { label: t('digitalTwin.windowRP', 'Rear Passenger'), value: windowLabel(twinState.windowRP) },
  ], [twinState, t]);

  const securityItems = useMemo(() => [
    { label: t('digitalTwin.locked', 'Locked'), value: twinState.locked === null ? '—' : twinState.locked ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.driving', 'Driving'), value: twinState.isDriving ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.charging', 'Charging'), value: twinState.isCharging ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.sentryMode', 'Sentry Mode'), value: twinState.sentryMode === null ? '—' : twinState.sentryMode ? t('common.active', 'Active') : t('common.inactive', 'Inactive') },
    { label: t('digitalTwin.chargePort', 'Charge Port'), value: twinState.isCharging ? t('digitalTwin.charging', 'Charging') : twinState.chargePortOpen === null ? '—' : twinState.chargePortOpen ? t('common.open', 'Open') : t('common.closed', 'Closed') },
    { label: t('digitalTwin.driverSeat', 'Driver Seat'), value: twinState.driverSeatOccupied === null ? '—' : twinState.driverSeatOccupied ? t('digitalTwin.occupied', 'Occupied') : t('digitalTwin.empty', 'Empty') },
    { label: t('digitalTwin.headlights', 'Headlights'), value: twinState.headlights === null ? '—' : twinState.headlights ? t('common.on', 'On') : t('common.off', 'Off') },
    { label: t('digitalTwin.hazards', 'Hazards'), value: twinState.hazards === null ? '—' : twinState.hazards ? t('common.active', 'Active') : t('common.off', 'Off') },
  ], [twinState, t]);

  return (
    <PageContainer
      title={t('digitalTwin.title', 'Digital Twin')}
      subtitle={t('digitalTwin.subtitle', 'Real-time vehicle physical state')}
      loading={vehiclesLoading}
      actions={<VehicleSelect />}
    >
      {!vehicle && !vehiclesLoading ? (
        <GlassPanel className="p-8">
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Car className="h-8 w-8" />} message={t('digitalTwin.noVehicles', 'No vehicles found. Add a vehicle to see its digital twin.')} />
        </GlassPanel>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Main visualization */}
          <FadeIn className="flex-1 flex items-center justify-center">
            <GlassPanel className="p-6 md:p-8 w-full">
              <VehicleTwin
                {...twinState}
                size="lg"
                interactive
                driveIn
                vehicleId={vehicle?.id}
                exteriorColor={vehicle?.exterior_color}
              />
              {vehicle?.id ? (
                <div className="mt-5 flex justify-center">
                  <VehiclePaintPicker
                    vehicleId={vehicle.id}
                    exteriorColor={vehicle.exterior_color}
                  />
                </div>
              ) : null}
              {twinState.lastUpdated && (
                <p className="text-center text-xs text-[var(--text-muted)] mt-4">
                  {t('digitalTwin.lastUpdated', 'Last updated')}: {new Date(twinState.lastUpdated).toLocaleTimeString()}
                </p>
              )}
            </GlassPanel>
          </FadeIn>

          {/* Side detail panels */}
          <div className="w-full lg:w-80 space-y-4">
            {/* Doors panel */}
            <FadeIn delay={0.05}>
              <GlassPanel className="p-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                  {t('digitalTwin.doorsTitle', 'Doors & Openings')}
                </h3>
                {securityData ? (
                  <KVList items={doorItems} columns={2} />
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Info className="h-6 w-6" />} message={t('digitalTwin.noDoorData', 'No door data available')} />
                )}
              </GlassPanel>
            </FadeIn>

            {/* Windows panel */}
            <FadeIn delay={0.1}>
              <GlassPanel className="p-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                  {t('digitalTwin.windowsTitle', 'Windows')}
                </h3>
                {securityData ? (
                  <KVList items={windowItems} columns={2} />
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Info className="h-6 w-6" />} message={t('digitalTwin.noWindowData', 'No window data available')} />
                )}
              </GlassPanel>
            </FadeIn>

            {/* Security & Status panel */}
            <FadeIn delay={0.15}>
              <GlassPanel className="p-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                  {t('digitalTwin.securityTitle', 'Security & Status')}
                </h3>
                <KVList items={securityItems} columns={2} />
                {vehicle && (
                  <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                    <StatusBadge status={badgeStatus} />
                  </div>
                )}
              </GlassPanel>
            </FadeIn>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
