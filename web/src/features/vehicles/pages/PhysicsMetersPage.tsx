import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { Evidence, RawRows } from '../components/tesla-physics/Evidence';
import { PhysicsPageShell, time, unknown, usePhysicsPage } from '../components/tesla-physics/PhysicsPageShell';

export default function PhysicsMetersPage() {
  const physics = usePhysicsPage('meters');
  const { report, t } = physics;
  const { formatDistance } = useUnits();
  const distance = (m: number | null | undefined) => m == null ? unknown(t) : formatDistance(m, { precision: 1 });
  const meter = report?.meters;
  const resets = meter?.resets ?? [];
  const drops = resets.flatMap((row) => row.from_m != null && row.to_m != null && row.from_m > row.to_m
    ? [{ ...row, delta: row.from_m - row.to_m }] : []);
  const largest = drops.length ? drops.reduce((a, b) => a.delta > b.delta ? a : b) : null;
  const byMeter = [...new Set(resets.map((row) => row.meter))];
  const epochs = report?.firmware_epochs?.epochs ?? [];
  const modes = report?.modes;
  const fsdFraction = meter?.fsd_distance_m != null && meter.driving_distance_m != null && meter.driving_distance_m > 0
    ? 100 * meter.fsd_distance_m / meter.driving_distance_m : null;
  return <PhysicsPageShell physics={physics}>
    <Evidence title={physics.title} honesty={meter?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.odometer', 'Odometer')} value={distance(meter?.odometer_m)} color="cyan" />
        <MetricCard label={t('teslaOnly.drivingMeter', 'Driving trip meter')} value={distance(meter?.driving_distance_m)} color="green" />
        <MetricCard label={t('teslaOnly.fsdMeter', 'FSD trip meter')} value={distance(meter?.fsd_distance_m)} color="purple" />
      </Grid>
      <Text as="p" variant="caption">{t('teslaOnly.metersSnapshot', 'These are the latest returned counters; the report does not timestamp each current counter reading or provide a continuous counter time series. The FSD counter does not measure engaged FSD driving.')}</Text>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.workbench.resetSummary', '{{count}} returned meter drops; inspect before and after readings below.', { count: resets.length })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.metersQuantified', 'Quantifiable drops: {{count}}', { count: drops.length })}</Badge>
        <Badge variant="warning" size="sm">{t('teslaOnly.metersLargest', 'Largest measured drop: {{value}}', { value: largest ? distance(largest.delta) : unknown(t) })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.metersRelative', 'FSD counter / driving counter: {{value}}', { value: fsdFraction == null ? unknown(t) : `${fmtNumber(fsdFraction, 1)}%` })}</Badge>
      </div>
      <Text as="p" variant="caption">{t('teslaOnly.metersRatioNote', 'The counter ratio compares two returned readings only. It does not indicate FSD engagement share, particularly across resets or different counter scopes.')}</Text>
      <div className="grid gap-2 sm:grid-cols-2">{byMeter.map((name) => <div key={name} className="rounded-lg border border-[var(--glass-border)] p-3">
        <Text as="p" variant="bodySm">{t('teslaOnly.metersCountByType', '{{meter}}: {{count}} returned drops', { meter: name, count: resets.filter((row) => row.meter === name).length })}</Text>
      </div>)}</div>
    </Evidence>
    <Evidence title={t('teslaOnly.metersTimeline', 'Observed counter changes and firmware bounds')}>
      {resets.length ? resets.slice(-8).reverse().map((row) => <div key={`${row.meter}-${row.at}`} className="rounded-lg border border-[var(--glass-border)] p-3">
        <Text as="p" variant="bodySm">{t('teslaOnly.workbench.resetReading', '{{meter}}: {{before}} → {{after}} at {{at}}', {
          meter: row.meter, before: distance(row.from_m), after: distance(row.to_m), at: time(row.at, t),
        })}</Text><Text as="p" variant="caption">{row.cause}{row.unknown ? ` · ${unknown(t)}` : ''}</Text>
      </div>) : <Text as="p" variant="bodySm">{t('teslaOnly.metersNoDrops', 'No meter drops were returned in this bounded window. That does not establish counter stability between unobserved readings.')}</Text>}
      {epochs.length ? epochs.map((epoch) => <div key={`${epoch.version}-${epoch.started_at}`} className="rounded-lg border border-[var(--glass-border)] p-3">
        <Text as="p" variant="bodySm">{t('teslaOnly.metersEpoch', 'Firmware {{version}} observed {{from}} → {{to}}', {
          version: epoch.version, from: time(epoch.started_at, t), to: time(epoch.ended_at, t),
        })}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.metersEpochCounters', 'FSD counter bounds: {{from}} → {{to}}', {
          from: distance(epoch.fsd_meter_start_m), to: distance(epoch.fsd_meter_end_m),
        })}</Text>
      </div>) : <Text as="p" variant="caption">{t('teslaOnly.metersNoEpochs', 'No firmware counter bounds were returned for cross-checking.')}</Text>}
      <Text as="p" variant="bodySm">{t('teslaOnly.metersModeContext', 'Latest mode context: Valet {{valet}}, Service {{service}}, Transport {{transport}}', {
        valet: modes?.valet == null ? unknown(t) : modes.valet ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
        service: modes?.service == null ? unknown(t) : modes.service ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
        transport: modes?.transport == null ? unknown(t) : modes.transport ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
      })}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.metersModeCaution', 'Latest modes are not historical mode readings at each drop. Firmware epoch bounds are observations, not a continuous trace or proof of cause.')}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.metersAnalysis', 'Counters are current returned readings, not lifetime totals. A drop is a difference between before and after counter values, not lost driven distance. The cause is classified from nearby mode or firmware evidence, not established as fact. Compare Firmware Epochs.')}</Text>
      <RawRows title={physics.title} rows={[...resets].reverse()} tableId="physics:meters" t={t} mobileColumns={['meter', 'at', 'drop']}
        keyExtractor={(r) => `${r.meter}-${r.at}`} columns={[
          { key: 'meter', header: t('teslaOnly.meter', 'Meter'), render: (r) => r.meter },
          { key: 'at', header: t('teslaOnly.started', 'Started'), render: (r) => time(r.at, t) },
          { key: 'before', header: t('teslaOnly.before', 'Before'), render: (r) => distance(r.from_m) },
          { key: 'after', header: t('teslaOnly.after', 'After'), render: (r) => distance(r.to_m) },
          { key: 'drop', header: t('teslaOnly.metersDrop', 'Measured drop'), render: (r) => r.from_m != null && r.to_m != null && r.from_m > r.to_m ? distance(r.from_m - r.to_m) : unknown(t) },
          { key: 'cause', header: t('teslaOnly.cause', 'Cause'), render: (r) => r.cause },
        ]} />
    </Evidence>
  </PhysicsPageShell>;
}
