import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { useOutageAutobiography, useSessionCertificate } from '@/api/hooks/useTeslaPhysics';
import { Badge, Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { downloadJSON, defaultExportFilename } from '@/lib/csvExport';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';

export default function OutageAutobiographyPage() {
  const { t } = useTranslation();
  usePageTitle(t('system.outage.title', 'Outage autobiography'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const outageQuery = useOutageAutobiography(vehicleIdStr);
  const certificateQuery = useSessionCertificate(vehicleIdStr);
  const state = useDataState(outageQuery, { provenance: 'live' });
  const outage = state.data;

  return (
    <PageContainer
      title={t('system.outage.title', 'Outage autobiography')}
      subtitle={outage?.honesty ?? t('system.outage.subtitle', 'What queued, what replayed with original event time, what stayed unknown.')}
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
          {t('system.outage.certificate', 'Session certificate')}
        </Button>
      )}
      query={outageQuery}
    >
      <StaleRefreshWarning state={state} />
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void outageQuery.refetch(); }} />
      ) : outage ? (
        <GlassPanel className="space-y-3 p-4 sm:p-5">
          <PanelTitle>{t('system.outage.catchUp', 'Catch-up after MQTT or carbon loss')}</PanelTitle>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={outage.mqtt_connected == null ? 'neutral' : outage.mqtt_connected ? 'success' : 'warning'}
              size="sm"
            >
              {outage.mqtt_connected == null
                ? t('system.outage.mqttUnknown', 'MQTT state unknown')
                : outage.mqtt_connected
                  ? t('system.outage.mqttUp', 'MQTT connected')
                  : t('system.outage.mqttDown', 'MQTT not connected')}
            </Badge>
            {outage.replay_preserves_event_time ? (
              <Badge variant="info" size="sm">{t('system.outage.replay', 'Replay keeps event time')}</Badge>
            ) : null}
          </div>
          <Text as="p" variant="caption">
            {t('system.outage.lastTelemetry', 'Last telemetry: {{when}}', {
              when: outage.last_telemetry_at ? formatDateTime(outage.last_telemetry_at) : t('system.outage.never', 'unknown'),
            })}
          </Text>
          {outage.gap_s != null && (
            <Text as="p" variant="caption">
              {t('system.outage.gap', 'Gap {{minutes}} min', { minutes: fmtNumber(outage.gap_s / 60, 1) })}
            </Text>
          )}
          {outage.unknown_since && (
            <Text as="p" variant="caption">
              {t('system.outage.unknownSince', 'Unknown since {{when}} — a gap is not a measured zero.', {
                when: formatDateTime(outage.unknown_since),
              })}
            </Text>
          )}
          <ul className="list-disc space-y-1 pl-5">
            {outage.notes.map((note) => (
              <li key={note}><Text as="span" variant="caption">{note}</Text></li>
            ))}
          </ul>
        </GlassPanel>
      ) : null}
    </PageContainer>
  );
}
