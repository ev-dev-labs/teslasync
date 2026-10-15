import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, AppWindow, Car, DoorOpen, Info, Lightbulb, ShieldCheck,
} from 'lucide-react';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useAsOfDate } from '@/hooks/useAsOfDate';
import {
  useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest,
  deriveTrustedVehicleStatus, resolveVehicleStateFreshness,
} from '@/api/hooks/useVehicles';
import { PageLayout, Section } from '@/components/layout';
import { Badge, Button, GlassPanel, Icon, PanelTitle, Text } from '@/components/ui';
import { OperationalBrief, StatusBadge } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DataSourceNotice, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { FadeIn } from '@/components/motion';
import { VehicleTwin, VehiclePaintPicker } from '@/components/vehicles';

import { buildTwinState } from '@/lib/vehicleState';
import type { WindowState, TurnSignalState } from '@/lib/vehicleState';
import { VEHICLE_STATUSES } from '@/api/types';
import type { VehicleStatus } from '@/api/types';
import { asBoolean, asFiniteNumber, asNonEmptyString } from '@/lib/typeGuards';
import { typography, type NeonColor } from '@/lib/tokens';
import { formatObservationAge } from '@/lib/observationAge';
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

function trustedStatus(value: unknown): VehicleStatus | null {
  const status = asNonEmptyString(value)?.trim().toLowerCase();
  return VEHICLE_STATUSES.find((candidate) => candidate === status) ?? null;
}

function activityFrom(...signals: (boolean | null)[]): boolean | null {
  return signals.includes(true) ? true : signals.includes(false) ? false : null;
}

export default function DigitalTwinPage() {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();
  const { asOf } = useAsOfDate();
  const historical = asOf !== null;
  usePageTitle(t('digitalTwin.title', 'Digital twin'));

  const { vehicle } = useSelectedVehicle();
  const vehiclesQ = useVehicles();
  const vehiclesState = useDataState(vehiclesQ);
  const vehiclesLoading = !vehicle && !vehiclesState.hasData
    && !vehiclesState.fatalError && !vehiclesState.isRefreshBlocked && vehiclesQ.isFetching;
  const fleetEmpty = vehiclesQ.isSuccess && vehiclesQ.data?.length === 0;
  const vehicleId = vehicle?.id ?? 0;

  const securityQ = useSecurityLatest(vehicleId, REFRESH_INTERVAL);
  const stateQ = useVehicleState(vehicleId, { refetchInterval: REFRESH_INTERVAL });
  const chargingQ = useChargingTelemetryLatest(vehicleId, REFRESH_INTERVAL);
  const securityState = useDataState(securityQ, { provenance: 'live' });
  const stateState = useDataState(stateQ, { provenance: historical ? 'historical' : 'live' });
  const chargingState = useDataState(chargingQ, { provenance: 'live' });

  const securityData = securityQ.data ?? null;
  const chargingData = chargingQ.data ?? null;
  const vehicleState = stateQ.data?.state ?? null;
  const reportedStatus = trustedStatus(vehicleState?.state);
  const speed = asFiniteNumber(vehicleState?.speed);
  const chargerPower = asFiniteNumber(vehicleState?.charger_power);
  const telemetryPower = asFiniteNumber(chargingData?.charger_power_w);
  const chargingStatus = asNonEmptyString(chargingData?.charging_state)?.trim().toLowerCase();
  const hasActivityStatus = reportedStatus === 'charging' || reportedStatus === 'driving' || reportedStatus === 'parked';
  const isCharging = activityFrom(
    asBoolean(vehicleState?.is_charging),
    chargerPower === null ? null : chargerPower > 0,
    telemetryPower === null ? null : telemetryPower > 0,
    chargingStatus === 'charging' || chargingStatus === 'starting' ? true
      : ['complete', 'stopped', 'disconnected', 'nopower'].includes(chargingStatus ?? '') ? false : null,
    hasActivityStatus ? reportedStatus === 'charging' : null,
  );
  const isDriving = activityFrom(
    speed === null ? null : speed !== 0,
    hasActivityStatus ? reportedStatus === 'driving' : null,
  );

  const twinState = useMemo(
    () => ({
      ...buildTwinState(securityData, vehicleState ? {
        ...vehicleState,
        state: reportedStatus,
        speed,
        is_charging: asBoolean(vehicleState.is_charging),
        charger_power: chargerPower,
      } : null, chargingData ? {
        ...chargingData,
        charging_state: chargingStatus ?? null,
      } : null),
      isCharging: isCharging === true,
      isDriving: isDriving === true,
    }),
    [securityData, vehicleState, chargingData, reportedStatus, speed, chargerPower, chargingStatus, isCharging, isDriving],
  );

  const badgeStatus = !historical && stateState.status === 'ok'
    ? deriveTrustedVehicleStatus(vehicleState, stateQ.data)
    : null;
  const streamFreshness = resolveVehicleStateFreshness(
    stateQ.data?.freshness, stateQ.data?.observedAt ?? null,
  );
  const observationAge = formatObservationAge(stateQ.data?.observedAt, t);
  const stateTitle = historical
    ? t('timeMachine.signalState', 'Reconstructed signal state')
    : t('digitalTwin.liveStatusTitle', 'Live status');
  const latestLabel = t('timeMachine.latest', 'Latest');
  const stateScope = historical
    ? t('timeMachine.banner.title', 'Viewing data as of {{when}}', { when: asOf })
    : latestLabel;
  const sourceObservation = [
    { label: t('digitalTwin.securityTitle', 'Security & status'), state: securityState, query: securityQ,
      scope: latestLabel, hasReading: securityData !== null, loading: securityQ.isLoading && securityQ.isFetching, timestamp: securityData?.ts },
    { label: stateTitle, state: stateState, query: stateQ,
      scope: stateScope, hasReading: vehicleState !== null, loading: stateQ.isLoading && stateQ.isFetching, timestamp: null },
    { label: t('common.charging', 'Charging'), state: chargingState, query: chargingQ,
      scope: latestLabel, hasReading: chargingData !== null, loading: chargingQ.isLoading && chargingQ.isFetching, timestamp: chargingData?.ts },
  ];
  const temporalScope = sourceObservation.map((source) => `${source.label}: ${source.scope}`).join(' · ');
  const sourceDescription = historical
    ? t('digitalTwin.brief.provenance', 'Security, vehicle-state and charging snapshots; retained values remain visible after a refresh failure.')
    : t('digitalTwin.brief.description', 'Latest polled security, vehicle-state and charging signals. Source snapshots may differ in time; unknown component states remain unknown.');

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

  const statusText = badgeStatus === null ? null : t(`digitalTwin.statusLabel.${badgeStatus}`, capitalize(badgeStatus));
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
      ? { variant: 'info', label: t('digitalTwin.sentryOn', 'Sentry on') }
      : { variant: 'neutral', label: t('digitalTwin.sentryOff', 'Sentry off') };
  const activityChip: { variant: BadgeVariant; label: string } = twinState.isCharging
    ? { variant: 'info', label: t('common.charging', 'Charging') }
    : twinState.isDriving
      ? { variant: 'success', label: t('common.driving', 'Driving') }
      : { variant: 'neutral', label: isCharging === false && isDriving === false
        ? t('common.parked', 'Parked') : '—' };

  // ── Detail-panel row models ──────────────────────────────────────────
  const doorItems = [
    { label: t('digitalTwin.doorDriverFront', 'Driver front'), value: openClosed(twinState.doors.driverFront) },
    { label: t('digitalTwin.doorPassengerFront', 'Passenger front'), value: openClosed(twinState.doors.passengerFront) },
    { label: t('digitalTwin.doorDriverRear', 'Driver rear'), value: openClosed(twinState.doors.driverRear) },
    { label: t('digitalTwin.doorPassengerRear', 'Passenger rear'), value: openClosed(twinState.doors.passengerRear) },
    { label: t('digitalTwin.frunk', 'Frunk'), value: openClosed(twinState.frunkOpen) },
    { label: t('digitalTwin.trunk', 'Trunk'), value: openClosed(twinState.trunkOpen) },
  ];

  const windowItems = [
    { label: t('digitalTwin.windowFD', 'Front driver'), value: windowLabel(twinState.windowFD) },
    { label: t('digitalTwin.windowFP', 'Front passenger'), value: windowLabel(twinState.windowFP) },
    { label: t('digitalTwin.windowRD', 'Rear driver'), value: windowLabel(twinState.windowRD) },
    { label: t('digitalTwin.windowRP', 'Rear passenger'), value: windowLabel(twinState.windowRP) },
  ];

  const securityItems = [
    { label: t('digitalTwin.locked', 'Locked'), value: twinState.locked === null ? '—' : twinState.locked ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.driving', 'Driving'), value: isDriving === null ? '—' : isDriving ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.charging', 'Charging'), value: isCharging === null ? '—' : isCharging ? t('common.yes', 'Yes') : t('common.no', 'No') },
    { label: t('digitalTwin.sentryMode', 'Sentry mode'), value: twinState.sentryMode === null ? '—' : twinState.sentryMode ? t('common.active', 'Active') : t('common.inactive', 'Inactive') },
    { label: t('digitalTwin.chargePort', 'Charge port'), value: twinState.isCharging ? t('digitalTwin.charging', 'Charging') : twinState.chargePortOpen === null ? '—' : twinState.chargePortOpen ? t('common.open', 'Open') : t('common.closed', 'Closed') },
    { label: t('digitalTwin.driverSeat', 'Driver seat'), value: twinState.driverSeatOccupied === null ? '—' : twinState.driverSeatOccupied ? t('digitalTwin.occupied', 'Occupied') : t('digitalTwin.empty', 'Empty') },
  ];

  const lightItems = [
    { label: t('digitalTwin.headlights', 'Headlights'), value: twinState.headlights === null ? '—' : twinState.headlights ? t('common.on', 'On') : t('common.off', 'Off') },
    { label: t('digitalTwin.hazards', 'Hazards'), value: twinState.hazards === null ? '—' : twinState.hazards ? t('common.active', 'Active') : t('common.off', 'Off') },
    { label: t('digitalTwin.turnSignal', 'Turn signal'), value: turnSignalLabel(twinState.turnSignal) },
  ];

  // The Security panel merges three streams — treat it as ready when any of
  // them has arrived, loading only while all are still pending.
  const anyLiveData = Boolean(securityData || vehicleState || chargingData);
  const combinedLoading = !anyLiveData && [securityQ, stateQ, chargingQ].some(
    (query) => query.isLoading && query.isFetching && query.fetchStatus !== 'paused',
  );
  const combinedError = anyLiveData ? undefined : (securityState.fatalError ?? stateState.fatalError ?? chargingState.fatalError);
  const retryUnavailable = () => {
    sourceObservation.forEach(({ query, state }) => {
      if (query.isError || state.isRefreshBlocked
        || (query.data === undefined && !query.isSuccess && !query.isFetching)) {
        void query.refetch();
      }
    });
  };

  const freshnessQueries = vehicleId > 0 ? [securityQ, stateQ, chargingQ] : undefined;
  const knownOpenings = openings.filter((opening) => opening !== null).length;
  const knownWindows = windowStates.filter((window) => window !== null).length;
  const summaryMetrics: readonly StatMetric[] = [
    { metricId: 'text', occurrenceId: 'twin-status', label: t('digitalTwin.kpiStatus', 'Status'),
      rawValue: statusText,
      description: sourceDescription },
    { metricId: 'text', occurrenceId: 'twin-lock', label: t('digitalTwin.kpiLock', 'Lock'),
      rawValue: twinState.locked === null ? null : lockValue,
      description: t('digitalTwin.brief.lockBasis', 'Latest reported lock state; an unknown state is not unlocked.') },
    { metricId: 'count', occurrenceId: 'twin-doors', label: t('digitalTwin.kpiDoorsOpen', 'Doors open'),
      rawValue: openingsKnown ? openCount : null,
      description: t('digitalTwin.brief.doorsBasis', 'Reported open doors, frunk and trunk. Unreported openings are not assumed closed.'),
      context: <><span>{t('digitalTwin.ofOpenings', 'of 6 openings')}</span> · <span>{t('digitalTwin.brief.openingsKnown', '{{count}} of 6 states known', { count: knownOpenings })}</span></> },
    { metricId: 'count', occurrenceId: 'twin-windows', label: t('digitalTwin.kpiWindowsOpen', 'Windows open'),
      rawValue: windowsKnown ? windowsOpenCount : null,
      description: t('digitalTwin.brief.windowsBasis', 'Open and partially open windows are counted together; unreported windows remain unknown.'),
      context: <><span>{t('digitalTwin.ofWindows', 'of 4 windows')}</span> · <span>{t('digitalTwin.brief.windowsKnown', '{{count}} of 4 states known', { count: knownWindows })}</span></> },
    { metricId: 'text', occurrenceId: 'twin-sentry', label: t('digitalTwin.kpiSentry', 'Sentry mode'),
      rawValue: twinState.sentryMode === null ? null : sentryValue,
      description: t('digitalTwin.brief.sentryBasis', 'Latest reported sentry state; inactive differs from unknown.') },
    { metricId: 'text', occurrenceId: 'twin-port', label: t('digitalTwin.kpiChargePort', 'Charge port'),
      rawValue: !twinState.isCharging && twinState.chargePortOpen === null ? null : chargePortValue,
      description: t('digitalTwin.brief.portBasis', 'Charging takes priority over the reported charge-port door state.') },
  ];
  const operationalMetrics = useOperationalMetrics(summaryMetrics);
  const sourceStates = [securityState, stateState, chargingState];
  const summaryStatus = combinedLoading ? 'loading'
    : sourceStates.some((source) => source.status === 'stale') ? 'stale'
    : sourceStates.some((source) => source.isRefreshBlocked) ? 'paused'
    : !anyLiveData && combinedError ? 'failed'
    : !anyLiveData ? 'unavailable'
    : !securityData || !vehicleState || !chargingData ? 'partial'
    : badgeStatus === null ? 'unverified'
    : 'ready';
  const summaryStatusLabels = {
    loading: t('digitalTwin.brief.status.loading', 'Loading source snapshots'),
    stale: t('digitalTwin.brief.status.stale', 'Retained source snapshots'),
    failed: t('digitalTwin.brief.status.failed', 'Source request failed'),
    unavailable: t('digitalTwin.brief.status.unavailable', 'No source snapshots'),
    partial: t('digitalTwin.brief.status.partial', 'Mixed source availability'),
    ready: t('digitalTwin.brief.status.ready', 'Source snapshots available'),
    paused: t('dataSources.status.paused', 'Refresh paused'),
    unverified: t('dashboard.fleetPosture.category.unverified', 'Unverified'),
  };

  return (
    <PageLayout
      title={t('digitalTwin.title', 'Digital twin')}
      subtitle={historical ? temporalScope : t('digitalTwin.subtitle', 'Real-time vehicle physical state')}
      loading={vehiclesLoading}
      query={freshnessQueries}
    >
      <StaleRefreshWarning state={vehiclesState} label={t('nav.vehicles', 'Fleet')} />
      {!vehicle && vehiclesState.fatalError ? (
        <GlassPanel className="p-8">
          <QueryError error={vehiclesState.fatalError} onRetry={vehiclesState.retry ?? undefined} />
        </GlassPanel>
      ) : !vehicle && fleetEmpty ? (
        <GlassPanel className="p-8">
          {/* no-action: transient empty state — no vehicle in the fleet yet. */}
          <EmptyState
            icon={<Icon icon={Car} className="h-8 w-8" aria-hidden />}
            message={t('digitalTwin.noVehicles', 'No vehicles found. Add a vehicle to see its digital twin.')}
          />
        </GlassPanel>
      ) : !vehicle ? (
        <GlassPanel className="p-8">
          {vehiclesState.isRefreshBlocked ? (
            <DataSourceNotice sources={[{ id: 'vehicles', label: t('nav.vehicles', 'Fleet'), query: vehiclesQ }]} />
          ) : (
            <Text variant="bodySm">{t('common.unavailable', 'Unavailable')}</Text>
          )}
        </GlassPanel>
      ) : (
        <div className="space-y-6">
          <DataSourceNotice sources={[
            { id: 'security', label: t('digitalTwin.securityTitle', 'Security & status'), query: securityQ },
            { id: 'state', label: stateTitle, query: stateQ },
            { id: 'charging', label: t('common.charging', 'Charging'), query: chargingQ },
          ]} />
          <StaleRefreshWarning state={securityState} label={t('digitalTwin.securityTitle', 'Security & status')} />
          <StaleRefreshWarning state={stateState} label={stateTitle} />
          <StaleRefreshWarning state={chargingState} label={t('common.charging', 'Charging')} />
          {/* 1 — KPI band: full-width responsive metric grid */}
          <FadeIn>
            <section
              aria-label={t('digitalTwin.overview', 'Overview')}
            >
              <OperationalBrief
                compact
                testId="digital-twin-summary"
                eyebrow={t('digitalTwin.brief.eyebrow', 'Vehicle physical state')}
                title={t('digitalTwin.brief.title', 'Physical-state summary')}
                description={sourceDescription}
                statusLabel={summaryStatusLabels[summaryStatus]}
                statusTone={summaryStatus === 'stale' || summaryStatus === 'partial' || summaryStatus === 'failed' ? 'warning' : 'neutral'}
                loading={combinedLoading}
                metrics={operationalMetrics}
                scope={<Text as="span" variant="caption">{vehicle?.display_name ?? '—'} · {historical ? temporalScope : t('digitalTwin.snapshot', 'Latest vehicle signals')}</Text>}
                freshness={<Text as="span" variant="caption">
                  {historical ? <>{t('digitalTwin.securityTitle', 'Security & status')} · {latestLabel} · </> : null}
                  {typeof twinState.lastUpdated === 'string'
                    ? t('digitalTwin.brief.timestamp', 'Signal timestamp: {{time}}', { time: formatTime(twinState.lastUpdated) })
                    : t('digitalTwin.brief.timestampUnknown', 'Signal timestamp unknown')}
                </Text>}
                provenance={[
                  t('digitalTwin.brief.provenance', 'Security, vehicle-state and charging snapshots; retained values remain visible after a refresh failure.'),
                  vehicle?.display_name ?? '—',
                  historical ? temporalScope : t('digitalTwin.snapshot', 'Latest vehicle signals'),
                  typeof twinState.lastUpdated === 'string'
                    ? twinState.lastUpdated
                    : t('digitalTwin.brief.timestampUnknown', 'Signal timestamp unknown'),
                ].join(' · ')}
              />
            </section>
          </FadeIn>

          {/* 2 — Hero: interactive twin + live status */}
          <FadeIn delay={0.1}>
            <Section id="twin-live-heading" title={historical ? t('digitalTwin.overview', 'Overview') : t('digitalTwin.sectionLive', 'Live overview')}>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
                <GlassPanel className="flex flex-col items-center justify-center p-6 sm:p-8 xl:col-span-2">
                  <VehicleTwin
                    {...twinState}
                    size="lg"
                    interactive
                    driveIn
                    vehicleId={vehicle?.id}
                    exteriorColor={vehicle?.exterior_color}
                    model={vehicle?.model}
                  />
                  {twinState.lastUpdated ? (
                    <Text as="p" variant="caption" className="mt-4 text-center">
                      {historical ? <>{t('digitalTwin.securityTitle', 'Security & status')} · {latestLabel} · </> : null}
                      {t('digitalTwin.lastUpdated', 'Last updated')}: {formatTime(twinState.lastUpdated)}
                    </Text>
                  ) : null}
                </GlassPanel>

                <GlassPanel className="flex flex-col p-4 sm:p-5">
                  <PanelTitle className="mb-3 flex items-center gap-2">
                    <Icon icon={Activity} className={typography.color.secondary} aria-hidden />
                    <span>{historical ? t('digitalTwin.brief.title', 'Physical-state summary') : stateTitle}</span>
                  </PanelTitle>
                  <div className="space-y-4">
                    <StatusBadge status={badgeStatus} label={statusText ?? undefined} />
                    <div className="space-y-2" data-testid="twin-source-observations">
                      {sourceObservation.map((source, index) => (
                        <Text as="p" variant="caption" key={source.label}>
                          {source.label}: {source.state.isRefreshBlocked
                            ? t('dataSources.status.paused', 'Refresh paused')
                            : source.state.status === 'stale'
                              ? t('digitalTwin.brief.status.stale', 'Retained source snapshots')
                              : source.state.fatalError
                                ? t('digitalTwin.brief.status.failed', 'Source request failed')
                              : !source.hasReading
                                ? source.loading
                                  ? t('digitalTwin.brief.status.loading', 'Loading source snapshots')
                                  : t('digitalTwin.brief.status.unavailable', 'No source snapshots')
                              : index === 1 && (historical || badgeStatus !== null)
                                ? t('digitalTwin.brief.status.ready', 'Source snapshots available')
                                : t('dashboard.fleetPosture.category.unverified', 'Unverified')}
                          {' · '}
                          {source.scope}
                          {' · '}
                          {index === 1
                            ? historical
                              ? typeof stateQ.data?.observedAt === 'number' && Number.isFinite(stateQ.data.observedAt)
                                ? t('digitalTwin.brief.timestamp', 'Signal timestamp: {{time}}', { time: formatTime(stateQ.data.observedAt) })
                                : t('digitalTwin.brief.timestampUnknown', 'Signal timestamp unknown')
                              : observationAge === null
                              ? t('dashboard.fleetPosture.scope.noObservation', 'No verified observation time for this vehicle')
                              : t('dashboard.fleetPosture.scope.observed', 'Last real observation {{age}}', { age: observationAge })
                            : typeof source.timestamp === 'string' && Number.isFinite(Date.parse(source.timestamp))
                              ? t('digitalTwin.brief.timestamp', 'Signal timestamp: {{time}}', { time: formatTime(source.timestamp) })
                              : t('digitalTwin.brief.timestampUnknown', 'Signal timestamp unknown')}
                          {index === 1 && !historical && streamFreshness === 'stale' ? <> · {t('freshness.stale', 'Stale')}</> : null}
                          {!source.hasReading && source.query.data === undefined
                            && !source.query.isSuccess && !source.query.isError
                            && !source.state.isRefreshBlocked && !source.query.isFetching ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="min-h-11"
                                aria-label={`${t('dataSources.retry', 'Retry unavailable sources')}: ${source.label}`}
                                onClick={() => { void source.query.refetch(); }}
                              >
                                {t('common.retry', 'Retry')}
                              </Button>
                            ) : null}
                        </Text>
                      ))}
                      <Text as="p" variant="caption">
                        {t('vehicleHero.observationLimitation', 'Telemetry stream observation does not verify individual reading timestamps or completeness.')}
                      </Text>
                    </div>
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
            </Section>
          </FadeIn>

          {/* 3 — Component state: full-width detail bento */}
          <FadeIn delay={0.2}>
            <Section id="twin-components-heading" title={t('digitalTwin.sectionComponents', 'Component state')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4 xl:gap-5">
                <TwinDetailPanel
                  title={t('digitalTwin.doorsTitle', 'Doors & openings')}
                  icon={<Icon icon={DoorOpen} className={typography.color.secondary} aria-hidden />}
                  items={doorItems}
                  isLoading={!securityData && securityQ.isLoading && securityQ.isFetching && !securityState.isRefreshBlocked}
                  error={securityState.fatalError}
                  isEmpty={!securityData}
                  emptyIcon={<Icon icon={Info} size="xl" aria-hidden />}
                  emptyMessage={t('digitalTwin.noDoorData', 'No door data available')}
                  onRetry={() => securityQ.refetch()}
                />
                <TwinDetailPanel
                  title={t('digitalTwin.windowsTitle', 'Windows')}
                  icon={<Icon icon={AppWindow} className={typography.color.secondary} aria-hidden />}
                  items={windowItems}
                  isLoading={!securityData && securityQ.isLoading && securityQ.isFetching && !securityState.isRefreshBlocked}
                  error={securityState.fatalError}
                  isEmpty={!securityData}
                  emptyIcon={<Icon icon={Info} size="xl" aria-hidden />}
                  emptyMessage={t('digitalTwin.noWindowData', 'No window data available')}
                  onRetry={() => securityQ.refetch()}
                />
                <TwinDetailPanel
                  title={t('digitalTwin.securityTitle', 'Security & status')}
                  icon={<Icon icon={ShieldCheck} className={typography.color.secondary} aria-hidden />}
                  items={securityItems}
                  isLoading={combinedLoading}
                  error={combinedError}
                  isEmpty={!anyLiveData}
                  emptyIcon={<Icon icon={Info} size="xl" aria-hidden />}
                  emptyMessage={t('digitalTwin.noSecurityData', 'No live status available')}
                  onRetry={retryUnavailable}
                  footer={<StatusBadge status={badgeStatus} label={statusText ?? undefined} />}
                />
                <TwinDetailPanel
                  title={t('digitalTwin.lightsTitle', 'Lights & signals')}
                  icon={<Icon icon={Lightbulb} className={typography.color.secondary} aria-hidden />}
                  items={lightItems}
                  isLoading={!securityData && securityQ.isLoading && securityQ.isFetching && !securityState.isRefreshBlocked}
                  error={securityState.fatalError}
                  isEmpty={!securityData}
                  emptyIcon={<Icon icon={Info} size="xl" aria-hidden />}
                  emptyMessage={t('digitalTwin.noLightData', 'No lights data available')}
                  onRetry={() => securityQ.refetch()}
                />
              </div>
            </Section>
          </FadeIn>
        </div>
      )}
    </PageLayout>
  );
}
