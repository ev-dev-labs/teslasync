import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { usePhysicsCockpit, useFsdHeartbeat, useSessionCertificate } from '@/api/hooks/useTeslaPhysics';
import { Badge, Button, Icon, Text } from '@/components/ui';
import { DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { PageLayout, LayoutCard, SourceContent } from '@/components/layout';
import type { DataState, DataStateSource } from '@/api/dataState';

import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { downloadJSON, defaultExportFilename } from '@/lib/csvExport';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VehicleEvidenceBrief } from '../components/operationalbrief-n-z/VehicleEvidenceBrief';

function sourceBodyState<T>(state: DataState<T>, query: DataStateSource<T>, hasContent: boolean) {
  if (state.fatalError) return 'error';
  if (state.hasData) return hasContent ? state.status === 'stale' ? 'retained' : 'ready' : 'empty';
  if (state.status === 'initial' && !state.isRefreshBlocked && query.isFetching) return 'loading';
  return 'empty';
}

export default function PhysicsCockpitPage() {
  const { formatDateTime } = useDateFormat();
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('vehicles.physicsCockpit.title', 'Tesla physics cockpit'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const cockpitQuery = usePhysicsCockpit(vehicleIdStr);
  const heartbeatQuery = useFsdHeartbeat(vehicleIdStr);
  const certificateQuery = useSessionCertificate(vehicleIdStr);
  const cockpitState = useDataState(cockpitQuery, { provenance: 'live' });
  const heartbeatState = useDataState(heartbeatQuery, { provenance: 'live' });
  const certificateState = useDataState(certificateQuery, { provenance: 'historical' });
  const cockpit = cockpitState.data;
  const heartbeat = heartbeatState.data;
  const certificate = certificateState.data;
  const hasVehicle = vehicleId != null;
  const canExport = hasVehicle && certificate?.vehicle_id === vehicleId;
  const prerequisite = t('common.noVehicleSelected.title', 'No vehicle selected');
  const unresolved = t('shareCard.states.pending', 'Source availability has not resolved yet.');
  const deferred = t('dataSources.status.paused', 'Refresh paused');
  const pendingContent = (state: DataState<unknown>, query: DataStateSource<unknown>) =>
    !hasVehicle ? <EmptyState message={prerequisite}
      actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }} />
      : state.status === 'initial' && (query.isPending || !query.isSuccess)
        ? <div role="status">
            <Text as="p" variant="bodySm">{unresolved}</Text>
            {state.isRefreshBlocked && <Text as="p" variant="bodySm">
              {deferred}
            </Text>}
          </div>
        : undefined;
  const { formatDistance, formatEnergy, formatSpeed } = useUnits();
  const readings: readonly StatMetric[] = [
    { metricId: 'status', occurrenceId: 'cockpit-gear', label: t('vehicles.physicsCockpit.gear', 'Gear'), rawValue: cockpit?.gear || null },
    { metricId: 'status', occurrenceId: 'cockpit-charge', label: t('vehicles.physicsCockpit.charge', 'Charge state'),
      rawValue: cockpit?.detailed_charge_state || cockpit?.charge_state || null },
    { metricId: 'status', occurrenceId: 'cockpit-latch', label: t('vehicles.physicsCockpit.latch', 'Charge port'),
      rawValue: cockpit?.charge_port_latch || (cockpit?.charge_port_door_open ? t('vehicles.physicsCockpit.portOpen', 'Open') : null) },
    { metricId: 'percent', occurrenceId: 'cockpit-battery', label: t('vehicles.physicsCockpit.battery', 'Battery'),
      rawValue: cockpit?.battery_level_pct ?? null,
      display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) } },
    { metricId: 'number', occurrenceId: 'cockpit-pack', label: t('vehicles.physicsCockpit.pack', 'Pack'),
      rawValue: cockpit?.pack_voltage_v ?? null,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'V' }) },
      context: t('vehicles.physicsCockpit.packContext', 'Pack voltage (V) and current (A) are independently reported; either may be unknown.') },
    { metricId: 'number', occurrenceId: 'cockpit-current', label: t('vehicles.physicsCockpit.packCurrent', 'Pack current'),
      rawValue: cockpit?.pack_current_a ?? null,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'A' }) } },
    { metricId: 'energy', occurrenceId: 'cockpit-energy', label: t('vehicles.physicsCockpit.energy', 'Energy remaining'),
      rawValue: cockpit?.energy_remaining_wh ?? null, display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'cockpit-trip', label: t('vehicles.physicsCockpit.trip', 'Trip meter'),
      rawValue: cockpit?.driving_distance_m ?? null, display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'speed', occurrenceId: 'cockpit-speed', label: t('vehicles.physicsCockpit.speed', 'Speed'),
      rawValue: cockpit?.speed_mps ?? null, display: { formatter: raw => ({ value: formatSpeed(raw), unit: '' }) } },
  ];

  return (
    <PageLayout
      title={t('vehicles.physicsCockpit.title', 'Tesla physics cockpit')}
      subtitle={t('vehicles.physicsCockpit.subtitle', 'Live gear, charge state, port latch, BMS, and trip meters.')}
      overflowActions={(
        <Button
          variant="secondary"
          size="sm"
          disabled={!canExport}
          wrapLabel
          className="min-h-11 md:min-h-9"
          onClick={() => {
            if (!canExport || !certificate) return;
            downloadJSON(defaultExportFilename('session-certificate'), certificate);
          }}
        >
          <Icon icon={Download} size="md" className="me-1" />
          {t('vehicles.physicsCockpit.certificate', 'Session certificate')}
        </Button>
      )}
      query={[cockpitQuery, heartbeatQuery, certificateQuery]}
    >
      {cockpit?.honesty && (
        <Text as="p" variant="bodySm">{cockpit.honesty}</Text>
      )}
      {!hasVehicle && <EmptyState message={prerequisite}
        actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }} />}
      <LayoutCard title={t('vehicles.physicsCockpit.snapshot', 'Live cockpit readings')}>
      <StaleRefreshWarning state={cockpitState} label={t('vehicles.physicsCockpit.snapshot', 'Live cockpit readings')}
        message={cockpitState.isRefreshBlocked ? deferred : undefined} />
      <SourceContent
        state={!hasVehicle || cockpitState.hasData && cockpitState.status === 'stale' ? 'ready' : sourceBodyState(cockpitState, cockpitQuery, !!cockpit)}
        label={t('vehicles.physicsCockpit.snapshot', 'Live cockpit readings')}
        emptyMessage={t('common.noData', 'No data available')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={cockpitState.fatalError}
        errorRecovery={{ onRetry: () => { void cockpitQuery.refetch(); } }}
        emptyContent={pendingContent(cockpitState, cockpitQuery)}
      >
        <VehicleEvidenceBrief refreshFailed={cockpitState.refreshError != null}
          variant="embedded"
          id="physics-cockpit-readings"
          title={t('vehicles.physicsCockpit.snapshot', 'Live cockpit readings')}
          description={t('vehicles.physicsCockpit.briefDescription', 'Independently reported cockpit measurements; a missing field is unknown, not zero.')}
          loading={hasVehicle && cockpitState.status === 'initial' && !cockpitState.isRefreshBlocked && cockpitQuery.isFetching}
          status={hasVehicle ? cockpitState.status : 'unavailable'}
          scope={t('vehicles.physicsCockpit.scopeUnknown', 'Latest returned fields; observation time is not supplied')}
          provenance={t('dataSources.labels.liveVehicleState', 'Live vehicle state')}
          freshness={<DataProvenanceBadge provenance={cockpitState.provenance} status={cockpitState.status} updatedAt={cockpitState.updatedAt} />}
          metrics={readings}
        />
      </SourceContent>
      </LayoutCard>
      <LayoutCard title={heartbeat?.label ?? t('vehicles.physicsCockpit.heartbeat', 'FSD trip-meter heartbeat')}>
        <SourceContent
          state={!hasVehicle ? 'empty' : sourceBodyState(heartbeatState, heartbeatQuery, !!heartbeat)}
          label={t('vehicles.physicsCockpit.heartbeat', 'FSD trip-meter heartbeat')}
          emptyMessage={t('vehicles.physicsCockpit.noHeartbeat', 'No trip-meter heartbeat has been reported.')}
          errorMessage={t('vehicles.physicsCockpit.heartbeatError', 'Trip-meter heartbeat could not be loaded.')}
          error={heartbeatState.fatalError}
          errorRecovery={{ onRetry: () => { void heartbeatQuery.refetch(); } }}
          retainedMessage={heartbeatState.isRefreshBlocked ? deferred : undefined}
          emptyContent={pendingContent(heartbeatState, heartbeatQuery)}
        >
        {heartbeat && <>
          <VehicleEvidenceBrief refreshFailed={heartbeatState.refreshError != null} id="physics-heartbeat-readings"
            variant="embedded"
            title={t('vehicles.physicsCockpit.heartbeatBrief', 'Trip-meter evidence')}
            description={heartbeat.honesty}
            status={heartbeatState.status}
            scope={<div className="flex flex-wrap gap-2">
              {heartbeat.valet_mode ? <Badge variant="warning" size="sm">{t('vehicles.physicsCockpit.valet', 'Valet')}</Badge> : null}
              {heartbeat.service_mode ? <Badge variant="warning" size="sm">{t('vehicles.physicsCockpit.service', 'Service')}</Badge> : null}
            </div>}
            provenance={t('dataSources.labels.liveVehicleState', 'Live vehicle state')}
            freshness={<DataProvenanceBadge provenance={heartbeatState.provenance} status={heartbeatState.status} updatedAt={heartbeatState.updatedAt} />}
            metrics={[
              { metricId: 'distance', occurrenceId: 'heartbeat-fsd', label: t('vehicles.physicsCockpit.fsdMeter', 'FSD trip meter'),
                rawValue: heartbeat.fsd_distance_m,
                missingReason: t('vehicles.physicsCockpit.fsdUnknown', 'FSD trip meter unknown'),
                display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) } },
              { metricId: 'text', occurrenceId: 'heartbeat-tick', label: t('vehicles.physicsCockpit.tick', 'Trip-meter tick'),
                rawValue: heartbeat.last_tick_at
                  ? t('vehicles.physicsCockpit.lastTick', 'Last tick {{when}}', { when: formatDateTime(heartbeat.last_tick_at) })
                  : t('vehicles.physicsCockpit.noTick', 'No trip-meter tick in the recent window') },
              { metricId: 'text', occurrenceId: 'heartbeat-firmware', label: t('vehicles.physicsCockpit.firmware', 'Firmware'),
                rawValue: heartbeat.firmware_version || null },
            ]} />
        </>}
        </SourceContent>
      </LayoutCard>
      <LayoutCard title={t('vehicles.physicsCockpit.park', 'Park truth')}>
        <SourceContent
          state={!hasVehicle ? 'empty' : sourceBodyState(cockpitState, cockpitQuery, !!cockpit?.park)}
          label={t('vehicles.physicsCockpit.park', 'Park truth')}
          emptyMessage={t('vehicles.physicsCockpit.noPark', 'No park evidence has been reported.')}
          errorMessage={t('vehicles.physicsCockpit.parkError', 'Park evidence could not be loaded.')}
          error={cockpitState.fatalError}
          errorRecovery={{ onRetry: () => { void cockpitQuery.refetch(); } }}
          retainedMessage={cockpitState.isRefreshBlocked ? deferred : undefined}
          emptyContent={pendingContent(cockpitState, cockpitQuery)}
        >
        {cockpit?.park ? <>
          <VehicleEvidenceBrief refreshFailed={cockpitState.refreshError != null} id="physics-park-readings"
            variant="embedded"
            title={t('vehicles.physicsCockpit.parkBrief', 'Park accounting evidence')}
            description={cockpit.park.honesty}
            status={cockpitState.status}
            provenance={t('dataSources.labels.liveVehicleState', 'Live vehicle state')}
            scope={t('vehicles.physicsCockpit.parkScope', 'Reported modes count only when the source confirms Park')}
            metrics={[{
              metricId: 'status', occurrenceId: 'park-confirmed', label: t('vehicles.physicsCockpit.park', 'Park truth'),
              rawValue: cockpit.park.confirmed_park
                ? t('vehicles.physicsCockpit.confirmedPark', 'Confirmed park')
                : t('vehicles.physicsCockpit.notPark', 'Not confirmed park'),
              context: <div className="flex flex-wrap gap-2">
            {cockpit.park.neutral_rolling ? (
              <Badge variant="warning" size="sm">{t('vehicles.physicsCockpit.neutral', 'Neutral is rolling')}</Badge>
            ) : null}
            {cockpit.park.sentry_counted ? (
              <Badge variant="info" size="sm">{t('vehicles.physicsCockpit.sentry', 'Sentry')}</Badge>
            ) : cockpit.park.sentry_reported ? (
              <Badge variant="neutral" size="sm">{t('vehicles.physicsCockpit.sentryIgnored', 'Sentry reported, not counted')}</Badge>
            ) : null}
            {cockpit.park.cabin_overheat_counted ? (
              <Badge variant="info" size="sm">{t('vehicles.physicsCockpit.overheat', 'Cabin overheat')}</Badge>
            ) : cockpit.park.cabin_overheat_reported ? (
              <Badge variant="neutral" size="sm">{t('vehicles.physicsCockpit.overheatIgnored', 'Cabin overheat reported, not counted')}</Badge>
            ) : null}
            {cockpit.park.preconditioning_counted ? (
              <Badge variant="info" size="sm">{t('vehicles.physicsCockpit.precondition', 'Preconditioning')}</Badge>
            ) : cockpit.park.preconditioning_reported ? (
              <Badge variant="neutral" size="sm">{t('vehicles.physicsCockpit.preconditionIgnored', 'Preconditioning reported, not counted')}</Badge>
            ) : null}
              </div>,
            }]} />
          {(cockpit.park.rejected ?? []).map((reason) => (
            <Text as="p" key={reason} variant="caption">{reason}</Text>
          ))}
        </> : null}
        </SourceContent>
      </LayoutCard>
      <LayoutCard title={t('vehicles.physicsCockpit.certificate', 'Session certificate')}>
        <SourceContent
          state={!hasVehicle ? 'empty' : certificateState.status === 'stale' && certificateState.hasData ? 'ready' : sourceBodyState(certificateState, certificateQuery, !!certificate)}
          label={t('vehicles.physicsCockpit.certificate', 'Session certificate')}
          emptyMessage={t('system.outage.certificateEmpty', 'A session certificate is not available for this vehicle yet.')}
          errorMessage={t('system.outage.certificateError', 'Unable to load the session certificate.')}
          error={certificateState.fatalError}
          errorRecovery={{ onRetry: () => { void certificateQuery.refetch(); } }}
          emptyContent={pendingContent(certificateState, certificateQuery)}
        >
          <StaleRefreshWarning state={certificateState} label={t('vehicles.physicsCockpit.certificate', 'Session certificate')}
            message={certificateState.isRefreshBlocked ? deferred : undefined} />
          {certificate && <>
            <Text as="p" variant="bodySm">{t('system.outage.certificateReady', 'The session certificate is available for download with its original evidence intact.')}</Text>
            <Text as="p" variant="caption">{t('teslaOnly.certificateWindow', 'Certificate window: {{from}} to {{to}} · Issued {{issued}}', {
              from: formatDateTime(certificate.from), to: formatDateTime(certificate.to), issued: formatDateTime(certificate.issued_at),
            })}</Text>
            <Text as="p" variant="bodySm">{certificate.rules}</Text>
            <Text as="p" variant="bodySm">{certificate.honesty}</Text>
            <DataProvenanceBadge provenance={certificateState.provenance} status={certificateState.status} updatedAt={certificateState.updatedAt} />
          </>}
        </SourceContent>
      </LayoutCard>
    </PageLayout>
  );
}
