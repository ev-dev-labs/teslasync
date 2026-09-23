import { Link } from 'react-router-dom';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { Evidence } from '../components/tesla-physics/Evidence';
import { PhysicsPageShell, seconds, time, unknown, usePhysicsPage } from '../components/tesla-physics/PhysicsPageShell';

export default function PhysicsCarKeptLivingPage() {
  const physics = usePhysicsPage('car-kept-living');
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
  return <PhysicsPageShell physics={physics}>
    <Evidence title={physics.title} honesty={living?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.lastTelemetry', 'Last recorded telemetry')} value={time(last, t)} color="cyan" />
        <MetricCard label={t('teslaOnly.missingSince', 'Elapsed since last event')} value={seconds(living?.never_received_gap_s, t)} color="amber" />
        <MetricCard label={t('teslaOnly.queued', 'Queued')} value={living?.queued_count ?? unknown(t)} color="purple" />
      </Grid>
      <div className="flex flex-wrap gap-2">
        <Badge variant={living?.mqtt_connected == null ? 'neutral' : living.mqtt_connected ? 'success' : 'warning'} size="sm">
          {living?.mqtt_connected == null ? t('teslaOnly.mqttUnknown', 'MQTT state unknown') : living.mqtt_connected ? t('teslaOnly.mqttUp', 'MQTT connected') : t('teslaOnly.mqttDown', 'MQTT not connected')}</Badge>
        <Badge variant={living?.replay_preserves_event_time ? 'info' : 'warning'} size="sm">
          {living?.replay_preserves_event_time ? t('teslaOnly.replay', 'Replay keeps event time') : t('teslaOnly.replayUnverified', 'Replay event-time preservation not confirmed')}</Badge>
      </div>
      <Text as="p" variant="bodySm">{t('teslaOnly.livingClockComparison', 'Three Clocks latest event: {{value}} · matches last telemetry: {{match}}', {
        value: time(clockLast, t), match: sameLast == null ? unknown(t) : sameLast ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
      })}</Text>
      <Text as="p" variant="bodySm">{t('teslaOnly.livingClockOffset', 'Absolute difference between returned last-event clocks: {{value}}', { value: seconds(clockOffset, t) })}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.livingCaution', 'Broker connectivity cannot reconstruct events never received; distinguish ingestion delay from missing vehicle history. Queue size is a snapshot, not a count of lost events.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.livingInvestigation', 'Ingestion and missing-history investigation')}>
      <Text as="p" variant="bodySm">{t('teslaOnly.livingSourceBound', 'Bounded history: {{count}} rows; available: {{status}}', {
        count: scope?.history_rows ?? unknown(t), status: scope?.history_available == null ? unknown(t) : scope.history_available ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
      })}</Text>
      <Grid cols={{ default: 1, md: 2 }} gap={3}>
        <MetricCard label={t('teslaOnly.livingClockIngest', 'Latest stored ingest timestamp')} value={time(clock?.ingest_time, t)} color="cyan" />
        <MetricCard label={t('teslaOnly.livingIngestLag', 'Latest paired ingest lag')} value={seconds(storedLag, t)} color="amber" />
      </Grid>
      <Text as="p" variant="caption">{t('teslaOnly.livingLagCaution', 'Paired ingest lag is measured for a returned clock reading only. It does not describe missing vehicle events or queue processing time.')}</Text>
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
  </PhysicsPageShell>;
}
