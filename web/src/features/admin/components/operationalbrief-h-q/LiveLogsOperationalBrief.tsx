import { OperationalBrief, type OperationalTone, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { LOG_STREAM_MAX_EVENTS } from '@/api/hooks/useLogStream';
import { LogConnectionBadge } from '../continuation-admin-1/LogConnectionBadge';
import type { useLiveLogsPage } from '../../hooks/useLiveLogsPage';

type Props = { controller: ReturnType<typeof useLiveLogsPage> };

export function LiveLogsOperationalBrief({ controller }: Props) {
  const { t, levelLabel, level, paused, enabled, stream, filteredEvents, fmtInt } = controller;
  const { precision, locale } = useNumberFormatting();
  const status = stream.error
    ? { label: t('liveLogs.status.error', 'Connection error'), tone: 'danger' as const }
    : !enabled
      ? { label: t('liveLogs.status.disconnected', 'Disconnected'), tone: 'neutral' as const }
      : !stream.isConnected
        ? { label: t('liveLogs.status.connecting', 'Connecting…'), tone: 'info' as const }
        : paused
          ? { label: t('liveLogs.status.paused', 'Paused (still receiving)'), tone: 'warning' as const }
          : { label: t('liveLogs.status.connected', 'Live'), tone: 'success' as const };
  const metrics: readonly StatMetric[] = [
    { metricId: 'status', occurrenceId: 'connection', rawValue: status.label,
      label: t('liveLogs.kpi.connection', 'Connection'),
      description: t('liveLogs.brief.connectionContext', 'Current SSE connection and client pause state') },
    { metricId: 'count', occurrenceId: 'visible', rawValue: filteredEvents.length,
      label: t('liveLogs.kpi.visible', 'Visible'),
      description: t('liveLogs.kpi.visibleSub', 'After filters') },
    { metricId: 'count', occurrenceId: 'buffered', rawValue: stream.events.length,
      label: t('liveLogs.kpi.buffered', 'Buffered'),
      description: t('liveLogs.kpi.capacity', { max: fmtInt(LOG_STREAM_MAX_EVENTS), defaultValue: '{{max}} max' }) },
    { metricId: 'count', occurrenceId: 'received', rawValue: stream.totalReceived,
      label: t('liveLogs.kpi.received', 'Received'),
      description: t('liveLogs.kpi.receivedSub', 'Since mount'),
      context: t('liveLogs.brief.counterReset', 'Clear buffer also resets received and drop counters.') },
    { metricId: 'count', occurrenceId: 'drops', rawValue: stream.drops,
      label: t('liveLogs.kpi.drops', 'Server drops'),
      description: t('liveLogs.kpi.dropsSub', 'Buffer overflow') },
    { metricId: 'text', occurrenceId: 'min-level', rawValue: levelLabel(level ?? 'info'),
      label: t('liveLogs.kpi.minLevel', 'Min level'),
      description: t('liveLogs.kpi.minLevelSub', 'Server filter') },
  ];
  const briefMetrics = useOperationalMetrics(metrics.map(metric => ({
    ...metric, display: { precision, units: { locale } },
  }))).map(metric => ({
    ...metric,
    ...(metric.key === 'connection' ? {
      value: <LogConnectionBadge isConnected={stream.isConnected} paused={paused}
        hasError={stream.error !== null} enabled={enabled} />,
    } : {}),
    ...(metric.key === 'drops' ? { tone: (stream.drops > 0 ? 'danger' : 'warning') as OperationalTone } : {}),
  }));
  const description = t('liveLogs.brief.description',
    'Client stream counters, the current rolling buffer and server filter state. These are not server-wide totals or a complete historical log window.');
  const scope = t('liveLogs.brief.scope', 'Current buffer · received and drops since mount or last clear');
  return (
    <section aria-label={t('liveLogs.kpi.aria', 'Live stream metrics')}>
      <OperationalBrief
        compact
        testId="live-logs-operational-brief"
        eyebrow={t('liveLogs.title', 'Live logs')}
        title={t('liveLogs.brief.title', 'Log stream summary')}
        description={description}
        statusLabel={status.label}
        statusTone={status.tone}
        metrics={briefMetrics}
        scope={<Text as="span" variant="caption">{scope}</Text>}
        freshness={<Text as="span" variant="caption">
          {t('liveLogs.brief.freshness', 'Connection state does not establish log-event freshness')}
        </Text>}
        provenance={t('liveLogs.brief.provenance', 'API server SSE log stream · client memory')}
        narrative={{
          whatChanged: description, whyItMatters: null,
          confidence: { label: 'not_scored', score: null, basis: [] },
          likelyCause: null, recommendedResponse: null,
          limitations: [
            t('liveLogs.brief.coverage', 'The rolling buffer is capacity-limited; it is not durable replay or complete server history.'),
            t('liveLogs.brief.counterReset', 'Clear buffer also resets received and drop counters.'),
          ],
          evidence: [],
          provenance: [{ source: t('liveLogs.brief.provenance', 'API server SSE log stream · client memory'), method: scope }],
        }}
      />
    </section>
  );
}
