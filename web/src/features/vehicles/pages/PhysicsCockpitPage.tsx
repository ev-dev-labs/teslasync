import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { usePhysicsCockpit, useFsdHeartbeat, useSessionCertificate } from '@/api/hooks/useTeslaPhysics';
import { Badge, Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { Grid, PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { downloadJSON, defaultExportFilename } from '@/lib/csvExport';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';

export default function PhysicsCockpitPage() {
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
    <PageContainer
      title={t('vehicles.physicsCockpit.title', 'Tesla physics cockpit')}
      subtitle={cockpit?.honesty ?? t('vehicles.physicsCockpit.subtitle', 'Live Gear, charge state, port latch, BMS, and trip meters.')}
      contextActions={<VehicleSelect />}
      secondaryActions={(
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
      <StaleRefreshWarning state={cockpitState} />
      {cockpitState.fatalError ? (
        <QueryError error={cockpitState.fatalError} onRetry={() => { void cockpitQuery.refetch(); }} />
      ) : (
        <Grid cols={{ default: 1, md: 2, xl: 4 }} gap={4}>
          <MetricCard label={t('vehicles.physicsCockpit.gear', 'Gear')} value={cockpit?.gear || '—'} color="cyan" />
          <MetricCard
            label={t('vehicles.physicsCockpit.charge', 'Charge state')}
            value={cockpit?.detailed_charge_state || cockpit?.charge_state || '—'}
            color="green"
          />
          <MetricCard
            label={t('vehicles.physicsCockpit.latch', 'Charge port')}
            value={cockpit?.charge_port_latch || (cockpit?.charge_port_door_open ? t('vehicles.physicsCockpit.portOpen', 'Open') : '—')}
            color="amber"
          />
          <MetricCard
            label={t('vehicles.physicsCockpit.battery', 'Battery')}
            value={cockpit?.battery_level_pct == null ? '—' : `${fmtNumber(cockpit.battery_level_pct, 0)}%`}
            color="purple"
          />
          <MetricCard
            label={t('vehicles.physicsCockpit.pack', 'Pack')}
            value={
              cockpit?.pack_voltage_v == null && cockpit?.pack_current_a == null
                ? '—'
                : `${cockpit.pack_voltage_v == null ? '—' : `${fmtNumber(cockpit.pack_voltage_v, 0)} V`} · ${cockpit.pack_current_a == null ? '—' : `${fmtNumber(cockpit.pack_current_a, 1)} A`}`
            }
            color="amber"
          />
          <MetricCard
            label={t('vehicles.physicsCockpit.energy', 'Energy remaining')}
            value={cockpit?.energy_remaining_wh == null ? '—' : formatEnergy(cockpit.energy_remaining_wh)}
            color="green"
          />
          <MetricCard
            label={t('vehicles.physicsCockpit.trip', 'Trip meter')}
            value={cockpit?.driving_distance_m == null ? '—' : formatDistance(cockpit.driving_distance_m, { precision: 1 })}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.physicsCockpit.speed', 'Speed')}
            value={cockpit?.speed_mps == null ? '—' : formatSpeed(cockpit.speed_mps)}
            color="purple"
          />
        </Grid>
      )}
      {heartbeat && (
        <GlassPanel className="mt-4 space-y-2 p-4 sm:p-5">
          <PanelTitle>{heartbeat.label}</PanelTitle>
          <Text as="p" variant="caption">{heartbeat.honesty}</Text>
          <div className="flex flex-wrap gap-2">
            <Badge variant="info" size="sm">
              {heartbeat.fsd_distance_m == null
                ? t('vehicles.physicsCockpit.fsdUnknown', 'FSD trip meter unknown')
                : formatDistance(heartbeat.fsd_distance_m, { precision: 1 })}
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
        </GlassPanel>
      )}
      {cockpit?.park && (
        <GlassPanel className="mt-4 space-y-2 p-4 sm:p-5">
          <PanelTitle>{t('vehicles.physicsCockpit.park', 'Park truth')}</PanelTitle>
          <Text as="p" variant="caption">{cockpit.park.honesty}</Text>
          <div className="flex flex-wrap gap-2">
            <Badge variant={cockpit.park.confirmed_park ? 'success' : 'neutral'} size="sm">
              {cockpit.park.confirmed_park
                ? t('vehicles.physicsCockpit.confirmedPark', 'Confirmed Park')
                : t('vehicles.physicsCockpit.notPark', 'Not confirmed Park')}
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
        </GlassPanel>
      )}
      {heartbeatState.fatalError ? (
        <QueryError error={heartbeatState.fatalError} onRetry={() => { void heartbeatQuery.refetch(); }} />
      ) : null}
    </PageContainer>
  );
}
