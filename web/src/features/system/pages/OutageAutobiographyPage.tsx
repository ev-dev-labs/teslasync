import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import { useOutageAutobiography, useSessionCertificate } from '@/api/hooks/useTeslaPhysics';
import { Badge, Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { PageLayout, SourceContent } from '@/components/layout';

import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { downloadJSON, defaultExportFilename } from '@/lib/csvExport';
import { formatDateTime } from '@/lib/dateFormat';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { SystemSummaryBrief } from '../components/operationalbrief-all/SystemSummaryBrief';

export default function OutageAutobiographyPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('system.outage.title', 'Outage autobiography'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const outageQuery = useOutageAutobiography(vehicleIdStr);
  const certificateQuery = useSessionCertificate(vehicleIdStr);
  const state = useDataState(outageQuery, { provenance: 'live' });
  const certificateState = useDataState(certificateQuery, { provenance: 'historical' });
  const outage = state.data;

  return (
    <PageLayout
      title={t('system.outage.title', 'Outage autobiography')}
      subtitle={outage?.honesty ?? t('system.outage.subtitle', 'What queued, what replayed with original event time, what stayed unknown.')}
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
          <Download className="me-1 h-4 w-4" aria-hidden="true" />
          {t('system.outage.certificate', 'Session certificate')}
        </Button>
      )}
      query={outageQuery}
    >
      <StaleRefreshWarning state={state} label={t('system.outage.title', 'Outage autobiography')} />
      <SystemSummaryBrief
        title={t('system.outage.catchUp', 'Catch-up after MQTT or carbon loss')}
        description={outage?.honesty ?? t('system.outage.subtitle', 'What queued, what replayed with original event time, what stayed unknown.')}
        scope={outage?.unknown_since
          ? t('system.outage.unknownSince', 'Unknown since {{when}} — a gap is not a measured zero.', { when: formatDateTime(outage.unknown_since) })
          : t('system.outage.brief.scope', 'Selected vehicle outage evidence; no fixed reporting window is supplied.')}
        freshness={outage?.last_telemetry_at ? formatDateTime(outage.last_telemetry_at) : undefined}
        available={state.hasData} loading={outageQuery.isLoading && !state.hasData} retained={state.hasData && outageQuery.isError}
        metrics={[{ metricId: 'duration', occurrenceId: 'gap', rawValue: outage?.gap_s,
          label: t('system.outage.brief.gapLabel', 'Telemetry gap'),
          context: outage?.gap_s != null ? t('system.outage.gap', 'Gap {{minutes}} min', { minutes: fmtNumber(outage.gap_s / 60) }) : undefined,
          display: { formatter: (raw) => ({ value: fmtNumber(raw / 60), unit: 'min' }) } }]}
        textMetrics={[
          { key: 'mqtt', label: t('system.outage.brief.connection', 'MQTT connection'),
            value: outage?.mqtt_connected == null ? t('system.outage.mqttUnknown', 'MQTT state unknown')
              : outage.mqtt_connected ? t('system.outage.mqttUp', 'MQTT connected') : t('system.outage.mqttDown', 'MQTT not connected'),
            valueState: outage?.mqtt_connected == null ? 'missing' : 'value',
            tone: outage?.mqtt_connected == null ? 'neutral' : outage.mqtt_connected ? 'success' : 'warning',
            detail: t('system.outage.subtitle', 'What queued, what replayed with original event time, what stayed unknown.') },
          { key: 'last-telemetry', label: t('system.outage.brief.lastTelemetry', 'Last telemetry'),
            value: outage?.last_telemetry_at ? formatDateTime(outage.last_telemetry_at) : '—',
            valueState: outage?.last_telemetry_at ? 'value' : 'missing',
            detail: <>{t('system.outage.lastTelemetry', 'Last telemetry: {{when}}', {
              when: outage?.last_telemetry_at ? formatDateTime(outage.last_telemetry_at) : t('system.outage.never', 'unknown'),
            })} · {t('system.outage.brief.timestampContext', 'Original event time; a missing timestamp does not imply zero traffic.')}</> },
        ]}
      />
        <GlassPanel className="space-y-3 p-4 sm:p-5">
          <SourceContent
            state={state.fatalError ? 'error' : outageQuery.isLoading && !outage ? 'loading' : !outage ? 'empty' : 'ready'}
            label={t('system.outage.title', 'Outage autobiography')}
            emptyMessage={t('system.outage.empty', 'No outage evidence has been recorded for this vehicle yet.')}
            errorMessage={t('system.outage.loadError', 'Unable to load outage evidence.')}
            error={state.fatalError}
            errorRecovery={{ onRetry: () => { void outageQuery.refetch(); } }}
          >
          {outage ? <>
          <div className="flex flex-wrap gap-2">
            {outage.replay_preserves_event_time ? (
              <Badge variant="info" size="sm">{t('system.outage.replay', 'Replay keeps event time')}</Badge>
            ) : null}
          </div>
          <ul className="list-disc space-y-1 ps-5">
            {(outage.notes ?? []).map((note) => (
              <li key={note}><Text as="span" variant="caption">{note}</Text></li>
            ))}
          </ul>
          </> : null}
          </SourceContent>
        </GlassPanel>
      <GlassPanel className="space-y-3 p-4 sm:p-5">
        <PanelTitle>{t('system.outage.certificate', 'Session certificate')}</PanelTitle>
        <StaleRefreshWarning state={certificateState} label={t('system.outage.certificate', 'Session certificate')} />
        {certificateState.fatalError ? (
          <QueryError error={certificateState.fatalError} onRetry={() => { void certificateQuery.refetch(); }} />
        ) : (
          <SourceContent
            state={certificateQuery.isLoading && !certificateState.hasData ? 'loading' : certificateState.hasData ? 'ready' : 'empty'}
            label={t('system.outage.certificate', 'Session certificate')}
            emptyMessage={t('system.outage.certificateEmpty', 'A session certificate is not available for this vehicle yet.')}
            errorMessage={t('system.outage.certificateError', 'Unable to load the session certificate.')}
          >
            <Text as="p" variant="bodySm">
              {t('system.outage.certificateReady', 'The session certificate is available for download with its original evidence intact.')}
            </Text>
          </SourceContent>
        )}
      </GlassPanel>
    </PageLayout>
  );
}
