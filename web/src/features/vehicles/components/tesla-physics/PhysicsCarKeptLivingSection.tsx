import { Link } from 'react-router-dom';
import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { Badge, Text } from '@/components/ui';
import { Evidence } from './Evidence';
import { type PhysicsPage, seconds, time, unknown } from './PhysicsPageShell';

export default function PhysicsCarKeptLivingSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const living = report?.car_kept_living;
  const clock = report?.clocks?.latest;
  const last = living?.last_telemetry_at;
  const clockLast = clock?.event_time;
  const sameLast = last && clockLast && Date.parse(last) === Date.parse(clockLast);
  const clockOffset = last && clockLast && Number.isFinite(Date.parse(last)) && Number.isFinite(Date.parse(clockLast))
    ? Math.abs(Date.parse(last) - Date.parse(clockLast)) / 1000 : null;
  const storedLag = clock?.event_time && clock.ingest_time &&
    Number.isFinite(Date.parse(clock.event_time)) && Number.isFinite(Date.parse(clock.ingest_time))
    ? (Date.parse(clock.ingest_time) - Date.parse(clock.event_time)) / 1000 : null;
  const scope = report?.evidence;
  return <>
    <Evidence title={physics.title} honesty={living?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-living-summary" available={living != null}
        description={t('teslaOnly.livingCaution', 'Broker connectivity cannot reconstruct events never received; distinguish ingestion delay from missing vehicle history. Queue size is a snapshot, not a count of lost events.')}
        metrics={[
          { metricId: 'text', occurrenceId: 'last', label: t('teslaOnly.lastTelemetry', 'Last recorded telemetry'), rawValue: last == null ? null : time(last, t), context: last },
          { metricId: 'duration', occurrenceId: 'gap', label: t('teslaOnly.missingSince', 'Elapsed since last event'), rawValue: living?.never_received_gap_s, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) } },
          { metricId: 'count', occurrenceId: 'queued', label: t('teslaOnly.queued', 'Queued'), rawValue: living?.queued_count },
          { metricId: 'duration', occurrenceId: 'offset', label: t('teslaOnly.livingClockOffsetLabel', 'Absolute difference between returned last-event clocks'), rawValue: clockOffset, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) } },
          { metricId: 'status', occurrenceId: 'mqtt', label: t('teslaOnly.mqttLabel', 'MQTT connection'), rawValue: living?.mqtt_connected == null ? null : living.mqtt_connected ? t('teslaOnly.mqttUp', 'MQTT connected') : t('teslaOnly.mqttDown', 'MQTT not connected') },
          { metricId: 'status', occurrenceId: 'replay', label: t('teslaOnly.replayLabel', 'Replay event-time preservation'), rawValue: living?.replay_preserves_event_time == null ? null : living.replay_preserves_event_time ? t('teslaOnly.replay', 'Replay keeps event time') : t('teslaOnly.replayUnverified', 'Replay event-time preservation not confirmed'), missingReason: t('teslaOnly.replayUnverified', 'Replay event-time preservation not confirmed') },
        ]} />
      <Text as="p" variant="bodySm">{t('teslaOnly.livingClockComparison', 'Three clocks latest event: {{value}} · matches last telemetry: {{match}}', {
        value: time(clockLast, t), match: sameLast == null ? unknown(t) : sameLast ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
      })}</Text>
      <Text as="p" variant="bodySm">{t('teslaOnly.livingClockOffset', 'Absolute difference between returned last-event clocks: {{value}}', { value: seconds(clockOffset, t) })}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.livingInvestigation', 'Ingestion and missing-history investigation')}>
      <Text as="p" variant="bodySm">{t('teslaOnly.livingSourceBound', 'Bounded history: {{count}} rows; available: {{status}}', {
        count: scope?.history_rows ?? unknown(t), status: scope?.history_available == null ? unknown(t) : scope.history_available ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
      })}</Text>
      <PhysicsEvidenceBrief physics={physics} id="physics-living-ingestion" available={report?.clocks != null}
        description={t('teslaOnly.livingLagCaution', 'Paired ingest lag is measured for a returned clock reading only. It does not describe missing vehicle events or queue processing time.')}
        metrics={[
          { metricId: 'text', occurrenceId: 'ingest', label: t('teslaOnly.livingClockIngest', 'Latest stored ingest timestamp'), rawValue: clock?.ingest_time == null ? null : time(clock.ingest_time, t), context: clock?.ingest_time },
          { metricId: 'duration', occurrenceId: 'lag', label: t('teslaOnly.livingIngestLag', 'Latest paired ingest lag'), rawValue: storedLag, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) } },
          { metricId: 'count', occurrenceId: 'history', label: t('teslaOnly.historyRowsLabel', 'Bounded history rows'), rawValue: scope?.history_available ? scope.history_rows : null },
        ]} />
      {scope?.history_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.historyCapped', 'History row cap reached')}</Badge>}
      {!scope && <Text as="p" variant="caption">{t('teslaOnly.scopeUnavailable', 'Evidence coverage metadata was not returned; counts cannot establish completeness.')}</Text>}
      <Text as="p" variant="caption">{t('teslaOnly.livingTriage', 'A connected broker with no recent vehicle event does not establish a silent vehicle. A queued event may arrive later with its original event time; the broker snapshot does not prove that all intervening telemetry was received.')}</Text>
      {(living?.notes ?? []).length ? (living?.notes ?? []).map((note, index) => <Text key={`${index}-${note}`} as="p" variant="bodySm">{note}</Text>) :
        <Text as="p" variant="bodySm">{t('teslaOnly.livingNoNotes', 'No explanatory notes returned; a silent broker does not identify the missing source.')}</Text>}
      <div className="flex flex-wrap gap-4">
        <Link to="/tesla-physics/clocks" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.livingOpenClocks', 'Inspect event and ingest clocks')} →</Link>
        <Link to="/tesla-physics/unknown" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.livingOpenUnknown', 'Inspect unknown-hour budgets')} →</Link>
      </div>
    </Evidence>
  </>;
}
