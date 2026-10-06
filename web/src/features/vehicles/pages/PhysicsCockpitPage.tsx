import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { usePhysicsCockpit, useFsdHeartbeat, useSessionCertificate } from '@/api/hooks/useTeslaPhysics';
import { Badge, Button, Text } from '@/components/ui';
import { DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { PageLayout, LayoutCard, SourceContent } from '@/components/layout';

import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { downloadJSON, defaultExportFilename } from '@/lib/csvExport';
import { formatDateTime } from '@/lib/dateFormat';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VehicleEvidenceBrief } from '../components/operationalbrief-n-z/VehicleEvidenceBrief';

export default function PhysicsCockpitPage() {
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
  const cockpit = cockpitState.data;
  const heartbeat = heartbeatState.data;
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
          disabled={!certificateQuery.data}
          onClick={() => {
            if (!certificateQuery.data) return;
            downloadJSON(defaultExportFilename('session-certificate'), certificateQuery.data);
          }}
        >
          <Download className="mr-1 h-4 w-4" aria-hidden="true" />
          {t('vehicles.physicsCockpit.certificate', 'Session certificate')}
        </Button>
      )}
      query={[cockpitQuery, heartbeatQuery]}
    >
      {cockpit?.honesty && (
        <Text as="p" variant="bodySm">{cockpit.honesty}</Text>
      )}
      <StaleRefreshWarning state={cockpitState} />
      {cockpitState.fatalError ? (
        <QueryError error={cockpitState.fatalError} onRetry={() => { void cockpitQuery.refetch(); }} />
      ) : (
        <VehicleEvidenceBrief
          id="physics-cockpit-readings"
          title={t('vehicles.physicsCockpit.snapshot', 'Live cockpit readings')}
          description={t('vehicles.physicsCockpit.briefDescription', 'Independently reported cockpit measurements; a missing field is unknown, not zero.')}
          loading={cockpitQuery.isLoading}
          status={cockpitState.status}
          scope={t('vehicles.physicsCockpit.scopeUnknown', 'Latest returned fields; observation time is not supplied')}
          provenance={t('dataSources.labels.liveVehicleState', 'Live vehicle state')}
          freshness={<DataProvenanceBadge provenance={cockpitState.provenance} status={cockpitState.status} updatedAt={cockpitState.updatedAt} />}
          metrics={readings}
        />
      )}
      <StaleRefreshWarning state={heartbeatState} />
      <LayoutCard title={heartbeat?.label ?? t('vehicles.physicsCockpit.heartbeat', 'FSD trip-meter heartbeat')}>
        <SourceContent
          state={heartbeatState.fatalError ? 'error' : heartbeat ? heartbeatState.status === 'stale' ? 'retained' : 'ready' : heartbeatQuery.isLoading ? 'loading' : 'empty'}
          label={t('vehicles.physicsCockpit.heartbeat', 'FSD trip-meter heartbeat')}
          emptyMessage={t('vehicles.physicsCockpit.noHeartbeat', 'No trip-meter heartbeat has been reported.')}
          errorMessage={t('vehicles.physicsCockpit.heartbeatError', 'Trip-meter heartbeat could not be loaded.')}
          error={heartbeatState.fatalError}
          errorRecovery={{ onRetry: () => { void heartbeatQuery.refetch(); } }}
        >
        {heartbeat && <>
          <VehicleEvidenceBrief id="physics-heartbeat-readings"
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
          state={cockpitState.fatalError ? 'error' : cockpit?.park ? cockpitState.status === 'stale' ? 'retained' : 'ready' : cockpitQuery.isLoading ? 'loading' : 'empty'}
          label={t('vehicles.physicsCockpit.park', 'Park truth')}
          emptyMessage={t('vehicles.physicsCockpit.noPark', 'No park evidence has been reported.')}
          errorMessage={t('vehicles.physicsCockpit.parkError', 'Park evidence could not be loaded.')}
          error={cockpitState.fatalError}
          errorRecovery={{ onRetry: () => { void cockpitQuery.refetch(); } }}
        >
        {cockpit?.park ? <>
          <VehicleEvidenceBrief id="physics-park-readings"
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
    </PageLayout>
  );
}
