import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, AppWindow, Car, DoorOpen, Info, Lightbulb, Lock, PlugZap, ShieldCheck, Unlock,
} from 'lucide-react';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest,
} from '@/api/hooks/useVehicles';
import { PageContainer } from '@/components/layout';
import { Badge, GlassPanel, PanelTitle, SectionTitle, Text } from '@/components/ui';
import { MetricCard, StatusBadge } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleTwin, VehiclePaintPicker } from '@/components/vehicles';
import { VehicleSelect } from '@/components/forms';
import { buildTwinState } from '@/lib/vehicleState';
import type { WindowState, TurnSignalState } from '@/lib/vehicleState';
import { deriveVehicleStatus } from '@/api/types';
import type { VehicleStatus } from '@/api/types';
import type { NeonColor } from '@/lib/tokens';
import { TwinDetailPanel } from '../components/TwinDetailPanel';

const REFRESH_INTERVAL = 5_000;

type BadgeVariant = 'success' | 'info' | 'warning' | 'neutral' | 'danger';

/** Maps the derived vehicle status to a color-blind-safe metric accent. */
const STATUS_NEON: Record<string, NeonColor> = {
  driving: 'green',
  charging: 'cyan',
  online: 'blue',
  offline: 'red',
  asleep: 'purple',
  sleeping: 'purple',
  parked: 'amber',
  idle: 'amber',
};

export function statusNeon(status: string): NeonColor {
  return STATUS_NEON[status] ?? 'cyan';
}

export function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '—';
}

export default function DigitalTwinPage() {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();
  usePageTitle(t('digitalTwin.title', 'Digital Twin'));

  const { vehicle } = useSelectedVehicle();
  const { isLoading: vehiclesLoading } = useVehicles();
  const vehicleId = vehicle?.id ?? 0;

  const securityQ = useSecurityLatest(vehicleId, REFRESH_INTERVAL);
  const stateQ = useVehicleState(vehicleId, { refetchInterval: REFRESH_INTERVAL });
  const chargingQ = useChargingTelemetryLatest(vehicleId, REFRESH_INTERVAL);

  const securityData = securityQ.data ?? null;
  const chargingData = chargingQ.data ?? null;
  const vehicleState = stateQ.data?.state ?? null;

  const twinState = useMemo(
    () => buildTwinState(securityData, vehicleState, chargingData),
    [securityData, vehicleState, chargingData],
  );

  // Single source-of-truth status for the badge. Prefers live activity
  // (charging/driving) and falls back to the state endpoint, then to any
  // flowing stream so an un-hydrated state endpoint doesn't read "offline".
  const badgeStatus = useMemo<VehicleStatus>(() => {
    if (twinState.isCharging) return 'charging';
    if (twinState.isDriving) return 'driving';
    const fromState = deriveVehicleStatus(vehicleState);
    if (fromState !== 'offline') return fromState;
    if (stateQ.data?.live || securityData || chargingData) return 'online';
    return 'offline';
  }, [twinState.isCharging, twinState.isDriving, vehicleState, stateQ.data?.live, securityData, chargingData]);

  // ── Display helpers (i18n-aware, null-safe) ──────────────────────────
  const openClosed = (v: boolean | null) =>
    v === null ? '—' : v ? t('common.open', 'Open') : t('common.closed', 'Closed');

  const windowLabel = (state: WindowState) => {
    switch (state) {
      case 'open': return t('common.open', 'Open');
      case 'closed': return t('common.closed', 'Closed');
      case 'partial': return t('digitalTwin.partial', 'Partial');
      default: return '—';
    }
  };

  const turnSignalLabel = (state: TurnSignalState) => {
    switch (state) {
      case 'left': return t('digitalTwin.turnLeft', 'Left');
      case 'right': return t('digitalTwin.turnRight', 'Right');
      case 'both': return t('digitalTwin.turnBoth', 'Both');
      case 'off': return t('common.off', 'Off');
      default: return '—';
    }
  };

  // ── Derived KPI aggregates ───────────────────────────────────────────
  const openings = [
    twinState.doors.driverFront,
    twinState.doors.passengerFront,
    twinState.doors.driverRear,
    twinState.doors.passengerRear,
    twinState.frunkOpen,
    twinState.trunkOpen,
  ];
  const openCount = openings.filter((o) => o === true).length;
  const openingsKnown = openings.some((o) => o !== null);

  const windowStates: WindowState[] = [
    twinState.windowFD, twinState.windowFP, twinState.windowRD, twinState.windowRP,
  ];
  const windowsOpenCount = windowStates.filter((w) => w === 'open' || w === 'partial').length;
  const windowsKnown = windowStates.some((w) => w !== null);

  const statusText = t(`digitalTwin.statusLabel.${badgeStatus}`, capitalize(badgeStatus));
  const lockValue = twinState.locked === null
    ? '—'
    : twinState.locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked');
  const sentryValue = twinState.sentryMode === null
    ? '—'
    : twinState.sentryMode ? t('common.active', 'Active') : t('common.inactive', 'Inactive');
  const chargePortValue = twinState.isCharging
    ? t('common.charging', 'Charging')
    : twinState.chargePortOpen === null
      ? '—'
      : twinState.chargePortOpen ? t('common.open', 'Open') : t('common.closed', 'Closed');

  // ── At-a-glance status chips (color paired with text) ────────────────
  const lockChip: { variant: BadgeVariant; label: string } = twinState.locked === null
    ? { variant: 'neutral', label: t('digitalTwin.lockUnknown', 'Lock unknown') }
    : twinState.locked
      ? { variant: 'success', label: t('common.locked', 'Locked') }
      : { variant: 'warning', label: t('common.unlocked', 'Unlocked') };
  const sentryChip: { variant: BadgeVariant; label: string } = twinState.sentryMode === null
    ? { variant: 'neutral', label: t('digitalTwin.sentryUnknown', 'Sentry unknown') }
    : twinState.sentryMode
      ? { variant: 'info', label: t('digitalTwin.sentryOn', 'Sentry On') }
      : { variant: 'neutral', label: t('digitalTwin.sentryOff', 'Sentry Off') };
  const activityChip: { variant: BadgeVariant; label: string } = twinState.isCharging
    ? { variant: 'info', label: t('common.charging', 'Charging') }
    : twinState.isDriving
      ? { variant: 'success', label: t('common.driving', 'Driving') }
      : { variant: 'neutral', label: t('common.parked', 'Parked') };

  // ── Detail-panel row models ──────────────────────────────────────────
  const doorItems = [
    { label: t('digitalTwin.doorDriverFront', 'Driver Front'), value: openClosed(twinState.doors.driverFront) },
    { label: t('digitalTwin.doorPassengerFront', 'Passenger Front'), value: openClosed(twinState.doors.passengerFront) },
    { label: t('digitalTwin.doorDriverRear', 'Driver Rear'), value: openClosed(twinState.doors.driverRear) },
    { label: t('digitalTwin.doorPassengerRear', 'Passenger Rear'), value: openClosed(twinState.doors.passengerRear) },
    { label: t('digitalTwin.frunk', 'Frunk'), value: openClosed(twinState.frunkOpen) },
    { label: t('digitalTwin.trunk', 'Trunk'), value: openClosed(twinState.trunkOpen) },
  ];

  const windowItems = [
    { label: t('digitalTwin.windowFD', 'Front Driver'), value: windowLabel(twinState.windowFD) },
    { label: t('digitalTwin.windowFP', 'Front Passenger'), value: windowLabel(twinState.windowFP) },
    { label: t('digitalTwin.windowRD', 'Rear Driver'), value: windowLabel(twinState.windowRD) },
    { label: t('digitalTwin.windowRP', 'Rear Passenger'), value: windowLabel(twinState.windowRP) },
  ];

  const securityItems = [
    { label: t('digitalTwin.locked', 'Locked'), value: twinState.locked === null ? '—' : twinState.locked ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.driving', 'Driving'), value: twinState.isDriving ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.charging', 'Charging'), value: twinState.isCharging ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.sentryMode', 'Sentry Mode'), value: twinState.sentryMode === null ? '—' : twinState.sentryMode ? t('common.active', 'Active') : t('common.inactive', 'Inactive') },
    { label: t('digitalTwin.chargePort', 'Charge Port'), value: twinState.isCharging ? t('digitalTwin.charging', 'Charging') : twinState.chargePortOpen === null ? '—' : twinState.chargePortOpen ? t('common.open', 'Open') : t('common.closed', 'Closed') },
    { label: t('digitalTwin.driverSeat', 'Driver Seat'), value: twinState.driverSeatOccupied === null ? '—' : twinState.driverSeatOccupied ? t('digitalTwin.occupied', 'Occupied') : t('digitalTwin.empty', 'Empty') },
  ];

  const lightItems = [
    { label: t('digitalTwin.headlights', 'Headlights'), value: twinState.headlights === null ? '—' : twinState.headlights ? t('common.on', 'On') : t('common.off', 'Off') },
    { label: t('digitalTwin.hazards', 'Hazards'), value: twinState.hazards === null ? '—' : twinState.hazards ? t('common.active', 'Active') : t('common.off', 'Off') },
    { label: t('digitalTwin.turnSignal', 'Turn Signal'), value: turnSignalLabel(twinState.turnSignal) },
  ];

  // The Security panel merges three streams — treat it as ready when any of
  // them has arrived, loading only while all are still pending.
  const anyLiveData = Boolean(securityData || vehicleState || chargingData);
  const combinedLoading = !anyLiveData && (securityQ.isLoading || stateQ.isLoading || chargingQ.isLoading);
  const combinedError = anyLiveData ? undefined : (securityQ.error ?? stateQ.error ?? chargingQ.error);
  const refetchAll = () => {
    void securityQ.refetch();
    void stateQ.refetch();
    void chargingQ.refetch();
  };

  const freshnessQueries = vehicleId > 0 ? [securityQ, stateQ, chargingQ] : undefined;

  return (
    <PageContainer
      title={t('digitalTwin.title', 'Digital Twin')}
      subtitle={t('digitalTwin.subtitle', 'Real-time vehicle physical state')}
      loading={vehiclesLoading}
      actions={<VehicleSelect />}
      query={freshnessQueries}
    >
      {!vehicle && !vehiclesLoading ? (
        <GlassPanel className="p-8">
          {/* no-action: transient empty state — no vehicle in the fleet yet. */}
          <EmptyState
            icon={<Car className="h-8 w-8" aria-hidden="true" />}
            message={t('digitalTwin.noVehicles', 'No vehicles found. Add a vehicle to see its digital twin.')}
          />
        </GlassPanel>
      ) : (
        <div className="space-y-6">
          {/* 1 — KPI band: full-width responsive metric grid */}
          <FadeIn>
            <section
              aria-label={t('digitalTwin.overview', 'Overview')}
              className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-6"
            >
              <MetricCard
                label={t('digitalTwin.kpiStatus', 'Status')}
                value={statusText}
                icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                color={statusNeon(badgeStatus)}
              />
              <MetricCard
                label={t('digitalTwin.kpiLock', 'Lock')}
                value={lockValue}
                icon={twinState.locked === false ? <Unlock className="h-5 w-5" aria-hidden="true" /> : <Lock className="h-5 w-5" aria-hidden="true" />}
                color={twinState.locked === false ? 'amber' : 'green'}
              />
              <MetricCard
                label={t('digitalTwin.kpiDoorsOpen', 'Doors Open')}
                value={openingsKnown ? String(openCount) : '—'}
                subtitle={t('digitalTwin.ofOpenings', 'of 6 openings')}
                icon={<DoorOpen className="h-5 w-5" aria-hidden="true" />}
                color={openCount > 0 ? 'amber' : 'green'}
              />
              <MetricCard
                label={t('digitalTwin.kpiWindowsOpen', 'Windows Open')}
                value={windowsKnown ? String(windowsOpenCount) : '—'}
                subtitle={t('digitalTwin.ofWindows', 'of 4 windows')}
                icon={<AppWindow className="h-5 w-5" aria-hidden="true" />}
                color={windowsOpenCount > 0 ? 'amber' : 'green'}
              />
              <MetricCard
                label={t('digitalTwin.kpiSentry', 'Sentry Mode')}
                value={sentryValue}
                icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
                color={twinState.sentryMode ? 'cyan' : 'blue'}
              />
              <MetricCard
                label={t('digitalTwin.kpiChargePort', 'Charge Port')}
                value={chargePortValue}
                icon={<PlugZap className="h-5 w-5" aria-hidden="true" />}
                color={twinState.isCharging ? 'cyan' : 'blue'}
              />
            </section>
          </FadeIn>

          {/* 2 — Hero: interactive twin + live status */}
          <FadeIn delay={0.1}>
            <section aria-labelledby="twin-live-heading" className="space-y-3">
              <SectionTitle id="twin-live-heading">
                {t('digitalTwin.sectionLive', 'Live Overview')}
              </SectionTitle>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
                <GlassPanel className="flex flex-col items-center justify-center p-6 sm:p-8 xl:col-span-2">
                  <VehicleTwin
                    {...twinState}
                    size="lg"
                    interactive
                    driveIn
                    vehicleId={vehicle?.id}
                    exteriorColor={vehicle?.exterior_color}
                  />
                  {twinState.lastUpdated ? (
                    <Text as="p" variant="caption" className="mt-4 text-center">
                      {t('digitalTwin.lastUpdated', 'Last updated')}: {formatTime(twinState.lastUpdated)}
                    </Text>
                  ) : null}
                </GlassPanel>

                <GlassPanel className="flex flex-col p-4 sm:p-5">
                  <PanelTitle className="mb-3 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                    <span>{t('digitalTwin.liveStatusTitle', 'Live Status')}</span>
                  </PanelTitle>
                  <div className="space-y-4">
                    <StatusBadge status={badgeStatus} />
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={lockChip.variant}>{lockChip.label}</Badge>
                      <Badge variant={sentryChip.variant}>{sentryChip.label}</Badge>
                      <Badge variant={activityChip.variant}>{activityChip.label}</Badge>
                    </div>
                    {vehicle?.id ? (
                      <div className="pt-1">
                        <VehiclePaintPicker
                          vehicleId={vehicle.id}
                          exteriorColor={vehicle.exterior_color}
                        />
                      </div>
                    ) : null}
                  </div>
                </GlassPanel>
              </div>
            </section>
          </FadeIn>

          {/* 3 — Component state: full-width detail bento */}
          <FadeIn delay={0.2}>
            <section aria-labelledby="twin-components-heading" className="space-y-3">
              <SectionTitle id="twin-components-heading">
                {t('digitalTwin.sectionComponents', 'Component State')}
              </SectionTitle>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4 xl:gap-5">
                <TwinDetailPanel
                  title={t('digitalTwin.doorsTitle', 'Doors & Openings')}
                  icon={<DoorOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                  items={doorItems}
                  isLoading={securityQ.isLoading}
                  error={securityQ.error}
                  isEmpty={!securityData}
                  emptyIcon={<Info className="h-6 w-6" aria-hidden="true" />}
                  emptyMessage={t('digitalTwin.noDoorData', 'No door data available')}
                  onRetry={() => securityQ.refetch()}
                />
                <TwinDetailPanel
                  title={t('digitalTwin.windowsTitle', 'Windows')}
                  icon={<AppWindow className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                  items={windowItems}
                  isLoading={securityQ.isLoading}
                  error={securityQ.error}
                  isEmpty={!securityData}
                  emptyIcon={<Info className="h-6 w-6" aria-hidden="true" />}
                  emptyMessage={t('digitalTwin.noWindowData', 'No window data available')}
                  onRetry={() => securityQ.refetch()}
                />
                <TwinDetailPanel
                  title={t('digitalTwin.securityTitle', 'Security & Status')}
                  icon={<ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                  items={securityItems}
                  isLoading={combinedLoading}
                  error={combinedError}
                  isEmpty={!anyLiveData}
                  emptyIcon={<Info className="h-6 w-6" aria-hidden="true" />}
                  emptyMessage={t('digitalTwin.noSecurityData', 'No live status available')}
                  onRetry={refetchAll}
                  footer={<StatusBadge status={badgeStatus} />}
                />
                <TwinDetailPanel
                  title={t('digitalTwin.lightsTitle', 'Lights & Signals')}
                  icon={<Lightbulb className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                  items={lightItems}
                  isLoading={securityQ.isLoading}
                  error={securityQ.error}
                  isEmpty={!securityData}
                  emptyIcon={<Info className="h-6 w-6" aria-hidden="true" />}
                  emptyMessage={t('digitalTwin.noLightData', 'No lights data available')}
                  onRetry={() => securityQ.refetch()}
                />
              </div>
            </section>
          </FadeIn>
        </div>
      )}
    </PageContainer>
  );
}
