import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { KVList, StatusBadge } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { VehicleTwin } from '@/components/vehicles';
import { Select } from '@/components/ui';
import { buildTwinState, parseWindowState } from '@/lib/vehicleState';
import { Info, Car } from 'lucide-react';
import { useState } from 'react';

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

  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const vehicle = (vehicles ?? [])[selectedIdx];
  const vehicleId = vehicle?.id ?? 0;

  const { data: securityData } = useSecurityLatest(vehicleId, REFRESH_INTERVAL);
  const { data: vehicleStateData } = useVehicleState(vehicleId, { refetchInterval: REFRESH_INTERVAL });
  const { data: chargingData } = useChargingTelemetryLatest(vehicleId, REFRESH_INTERVAL);

  const vehicleState = vehicleStateData?.state ?? null;
  const twinState = useMemo(
    () => buildTwinState(securityData, vehicleState, chargingData),
    [securityData, vehicleState, chargingData],
  );

  const vehicleOptions = useMemo(
    () => (vehicles ?? []).map((v, i) => ({
      value: String(i),
      label: v.display_name || v.vin || `Vehicle ${v.id}`,
    })),
    [vehicles],
  );

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
    >
      {/* Vehicle selector (when multiple vehicles) */}
      {vehicleOptions.length > 1 && (
        <FadeIn>
          <div className="mb-4 max-w-xs">
            <Select
              options={vehicleOptions}
              value={String(selectedIdx)}
              onChange={(val) => setSelectedIdx(Number(val))}
            />
          </div>
        </FadeIn>
      )}

      {!vehicle && !vehiclesLoading ? (
        <GlassPanel className="p-8">
          <EmptyState icon={<Car className="h-8 w-8" />} message={t('digitalTwin.noVehicles', 'No vehicles found. Add a vehicle to see its digital twin.')} />
        </GlassPanel>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Main visualization */}
          <FadeIn className="flex-1 flex items-center justify-center">
            <GlassPanel className="p-6 md:p-8">
              <VehicleTwin {...twinState} size="lg" interactive driveIn />
              {twinState.lastUpdated && (
                <p className="text-center text-xs text-white/40 mt-4">
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
                <h3 className="text-sm font-semibold text-white/80 mb-3">
                  {t('digitalTwin.doorsTitle', 'Doors & Openings')}
                </h3>
                {securityData ? (
                  <KVList items={doorItems} columns={2} />
                ) : (
                  <EmptyState icon={<Info className="h-6 w-6" />} message={t('digitalTwin.noDoorData', 'No door data available')} />
                )}
              </GlassPanel>
            </FadeIn>

            {/* Windows panel */}
            <FadeIn delay={0.1}>
              <GlassPanel className="p-4">
                <h3 className="text-sm font-semibold text-white/80 mb-3">
                  {t('digitalTwin.windowsTitle', 'Windows')}
                </h3>
                {securityData ? (
                  <KVList items={windowItems} columns={2} />
                ) : (
                  <EmptyState icon={<Info className="h-6 w-6" />} message={t('digitalTwin.noWindowData', 'No window data available')} />
                )}
              </GlassPanel>
            </FadeIn>

            {/* Security & Status panel */}
            <FadeIn delay={0.15}>
              <GlassPanel className="p-4">
                <h3 className="text-sm font-semibold text-white/80 mb-3">
                  {t('digitalTwin.securityTitle', 'Security & Status')}
                </h3>
                <KVList items={securityItems} columns={2} />
                {vehicle && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <StatusBadge
                      status={vehicleState?.is_charging ? 'charging' : vehicleState?.state === 'online' ? 'online' : vehicleState?.state === 'asleep' ? 'asleep' : 'offline'}
                    />
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
