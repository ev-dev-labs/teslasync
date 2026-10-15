import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, time, unknown } from './PhysicsPageShell';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function PhysicsMetersSection({ physics }: { physics: PhysicsPage }) {
  const { fmtNumber } = useNumberFormatting();
  const { report, t } = physics;
  const { formatDistance } = useUnits();
  const distance = (m: number | null | undefined) => m == null ? unknown(t) : formatDistance(m);
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
  return <>
    <Evidence title={physics.title} honesty={meter?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-meters-summary" available={meter != null}
        description={t('teslaOnly.metersSnapshot', 'These are the latest returned counters; the report does not timestamp each current counter reading or provide a continuous counter time series. The FSD counter does not measure engaged FSD driving.')}
        metrics={[
          { metricId: 'distance', occurrenceId: 'odometer', label: t('teslaOnly.odometer', 'Odometer'), rawValue: meter?.odometer_m, display: { formatter: raw => ({ value: distance(raw), unit: '' }) } },
          { metricId: 'distance', occurrenceId: 'driving', label: t('teslaOnly.drivingMeter', 'Driving trip meter'), rawValue: meter?.driving_distance_m, display: { formatter: raw => ({ value: distance(raw), unit: '' }) } },
          { metricId: 'distance', occurrenceId: 'fsd', label: t('teslaOnly.fsdMeter', 'FSD trip meter'), rawValue: meter?.fsd_distance_m, display: { formatter: raw => ({ value: distance(raw), unit: '' }) } },
          { metricId: 'count', occurrenceId: 'drops', label: t('teslaOnly.workbench.resetCount', 'Returned meter drops'), rawValue: meter ? resets.length : null, context: t('teslaOnly.workbench.resetSummary', '{{count}} returned meter drops; inspect before and after readings below.', { count: resets.length }) },
          { metricId: 'count', occurrenceId: 'quantifiable', label: t('teslaOnly.metersQuantifiedLabel', 'Quantifiable drops'), rawValue: meter ? drops.length : null, context: t('teslaOnly.metersQuantified', 'Quantifiable drops: {{count}}', { count: drops.length }) },
          { metricId: 'distance', occurrenceId: 'largest-drop', label: t('teslaOnly.metersLargestLabel', 'Largest measured drop'), rawValue: largest?.delta, display: { formatter: raw => ({ value: distance(raw), unit: '' }) }, context: t('teslaOnly.metersLargest', 'Largest measured drop: {{value}}', { value: largest ? distance(largest.delta) : unknown(t) }) },
          { metricId: 'percent', occurrenceId: 'relative', label: t('teslaOnly.metersRelativeLabel', 'FSD counter / driving counter'), rawValue: fsdFraction, display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) }, context: <>{t('teslaOnly.metersRelative', 'FSD counter / driving counter: {{value}}', { value: fsdFraction == null ? unknown(t) : `${fmtNumber(fsdFraction)}%` })}<div>{t('teslaOnly.metersRatioNote', 'The counter ratio compares two returned readings only. It does not indicate FSD engagement share, particularly across resets or different counter scopes.')}</div></> },
          ...byMeter.map((name): import('@/components/data-display').StatMetric => ({ metricId: 'count', occurrenceId: `drops-${name}`, label: name, rawValue: resets.filter(row => row.meter === name).length, context: t('teslaOnly.metersCountByType', '{{meter}}: {{count}} returned drops', { meter: name, count: resets.filter(row => row.meter === name).length }) })),
        ]} />
      <Text as="p" variant="caption">{t('teslaOnly.metersRatioNote', 'The counter ratio compares two returned readings only. It does not indicate FSD engagement share, particularly across resets or different counter scopes.')}</Text>
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
      <Text as="p" variant="bodySm">{t('teslaOnly.metersModeContext', 'Latest mode context: valet {{valet}}, service {{service}}, transport {{transport}}', {
        valet: modes?.valet == null ? unknown(t) : modes.valet ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
        service: modes?.service == null ? unknown(t) : modes.service ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
        transport: modes?.transport == null ? unknown(t) : modes.transport ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No'),
      })}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.metersModeCaution', 'Latest modes are not historical mode readings at each drop. Firmware epoch bounds are observations, not a continuous trace or proof of cause.')}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.metersAnalysis', 'Counters are current returned readings, not lifetime totals. A drop is a difference between before and after counter values, not lost driven distance. The cause is classified from nearby mode or firmware evidence, not established as fact. Compare firmware epochs.')}</Text>
      <RawRows title={physics.title} rows={[...resets].reverse()} tableId="physics:meters" t={t} mobileColumns={['meter', 'at', 'drop']}
        keyExtractor={(r) => `${r.meter}-${r.at}`} columns={[
          { key: 'meter', header: t('teslaOnly.meter', 'Meter'), render: (r) => r.meter },
          { key: 'at', header: t('teslaOnly.started', 'Started'), render: (r) => time(r.at, t) },
          { key: 'before', align: 'right', header: t('teslaOnly.before', 'Before'), render: (r) => distance(r.from_m) },
          { key: 'after', align: 'right', header: t('teslaOnly.after', 'After'), render: (r) => distance(r.to_m) },
          { key: 'drop', align: 'right', header: t('teslaOnly.metersDrop', 'Measured drop'), render: (r) => r.from_m != null && r.to_m != null && r.from_m > r.to_m ? distance(r.from_m - r.to_m) : unknown(t) },
          { key: 'cause', header: t('teslaOnly.cause', 'Cause'), render: (r) => r.cause },
        ]} />
    </Evidence>
  </>;
}
