import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { usePhysicsCockpit, useFsdHeartbeat, useSessionCertificate } from '@/api/hooks/useTeslaPhysics';
import { Badge, Button, Text } from '@/components/ui';
import { StatStrip } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { PageLayout, LayoutCard, SourceContent } from '@/components/layout';

import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { downloadJSON, defaultExportFilename } from '@/lib/csvExport';
import { formatDateTime } from '@/lib/dateFormat';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
        <StatStrip
          id="physics-cockpit-readings"
          loading={cockpitQuery.isLoading}
          retained={cockpitState.status === 'stale'}
          period={{ kind: 'snapshot', label: t('vehicles.physicsCockpit.snapshot', 'Live cockpit readings'), observedAt: null,
            provenance: t('dataSources.labels.liveVehicleState', 'Live vehicle state') }}
          metrics={[
            { metricId: 'text', occurrenceId: 'cockpit-gear', label: t('vehicles.physicsCockpit.gear', 'Gear'), rawValue: cockpit?.gear || null },
            { metricId: 'text', occurrenceId: 'cockpit-charge', label: t('vehicles.physicsCockpit.charge', 'Charge state'),
              rawValue: cockpit?.detailed_charge_state || cockpit?.charge_state || null },
            { metricId: 'text', occurrenceId: 'cockpit-latch', label: t('vehicles.physicsCockpit.latch', 'Charge port'),
              rawValue: cockpit?.charge_port_latch || (cockpit?.charge_port_door_open ? t('vehicles.physicsCockpit.portOpen', 'Open') : null) },
            { metricId: 'text', occurrenceId: 'cockpit-battery', label: t('vehicles.physicsCockpit.battery', 'Battery'),
              rawValue: cockpit?.battery_level_pct == null ? null : `${fmtNumber(cockpit.battery_level_pct)}%` },
            { metricId: 'text', occurrenceId: 'cockpit-pack', label: t('vehicles.physicsCockpit.pack', 'Pack'), rawValue:
              cockpit?.pack_voltage_v == null && cockpit?.pack_current_a == null
                ? null
                : `${cockpit.pack_voltage_v == null ? '—' : `${fmtNumber(cockpit.pack_voltage_v)} V`} · ${cockpit.pack_current_a == null ? '—' : `${fmtNumber(cockpit.pack_current_a)} A`}`
            },
            { metricId: 'text', occurrenceId: 'cockpit-energy', label: t('vehicles.physicsCockpit.energy', 'Energy remaining'),
              rawValue: cockpit?.energy_remaining_wh == null ? null : formatEnergy(cockpit.energy_remaining_wh) },
            { metricId: 'text', occurrenceId: 'cockpit-trip', label: t('vehicles.physicsCockpit.trip', 'Trip meter'),
              rawValue: cockpit?.driving_distance_m == null ? null : formatDistance(cockpit.driving_distance_m) },
            { metricId: 'text', occurrenceId: 'cockpit-speed', label: t('vehicles.physicsCockpit.speed', 'Speed'),
              rawValue: cockpit?.speed_mps == null ? null : formatSpeed(cockpit.speed_mps) },
          ]}
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
          <Text as="p" variant="caption">{heartbeat.honesty}</Text>
          <div className="flex flex-wrap gap-2">
            <Badge variant="info" size="sm">
              {heartbeat.fsd_distance_m == null
                ? t('vehicles.physicsCockpit.fsdUnknown', 'FSD trip meter unknown')
                : formatDistance(heartbeat.fsd_distance_m)}
            </Badge>
            <Badge variant="neutral" size="sm">
              {heartbeat.last_tick_at
                ? t('vehicles.physicsCockpit.lastTick', 'Last tick {{when}}', { when: formatDateTime(heartbeat.last_tick_at) })
                : t('vehicles.physicsCockpit.noTick', 'No trip-meter tick in the recent window')}
            </Badge>
            {heartbeat.firmware_version ? <Badge variant="neutral" size="sm">{heartbeat.firmware_version}</Badge> : null}
            {heartbeat.valet_mode ? <Badge variant="warning" size="sm">{t('vehicles.physicsCockpit.valet', 'Valet')}</Badge> : null}
            {heartbeat.service_mode ? <Badge variant="warning" size="sm">{t('vehicles.physicsCockpit.service', 'Service')}</Badge> : null}
          </div>
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
          <Text as="p" variant="caption">{cockpit.park.honesty}</Text>
          <div className="flex flex-wrap gap-2">
            <Badge variant={cockpit.park.confirmed_park ? 'success' : 'neutral'} size="sm">
              {cockpit.park.confirmed_park
                ? t('vehicles.physicsCockpit.confirmedPark', 'Confirmed park')
                : t('vehicles.physicsCockpit.notPark', 'Not confirmed park')}
            </Badge>
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
          </div>
          {(cockpit.park.rejected ?? []).map((reason) => (
            <Text as="p" key={reason} variant="caption">{reason}</Text>
          ))}
        </> : null}
        </SourceContent>
      </LayoutCard>
    </PageLayout>
  );
}
