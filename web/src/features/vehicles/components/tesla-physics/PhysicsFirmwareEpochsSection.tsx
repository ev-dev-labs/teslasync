import { useState } from 'react';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Select, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, seconds, time, unknown } from './PhysicsPageShell';

export default function PhysicsFirmwareEpochsSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const { formatDistance } = useUnits();
  const distance = (m: number | null | undefined) => m == null ? unknown(t) : formatDistance(m, { precision: 1 });
  const epochs = report?.firmware_epochs?.epochs ?? [];
  const last = epochs.length ? epochs[epochs.length - 1] : undefined;
  const [filter, setFilter] = useState('');
  const versions = [...new Set(epochs.map((row) => row.version))];
  const selected = versions.includes(filter) ? filter : '';
  const visible = selected ? epochs.filter((row) => row.version === selected) : epochs;
  const bounded = epochs.filter((row) => row.fsd_meter_start_m != null && row.fsd_meter_end_m != null);
  const counterDrops = epochs.filter((row) => row.fsd_meter_start_m != null && row.fsd_meter_end_m != null &&
    row.fsd_meter_end_m < row.fsd_meter_start_m);
  const dwellObserved = epochs.filter((row) => row.complete_to_unplug_s != null);
  const latestBounded = bounded.length ? bounded[bounded.length - 1] : undefined;
  return <>
    <Evidence title={physics.title} honesty={report?.firmware_epochs?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.epochCount', 'Observed firmware epochs')} value={epochs.length} color="cyan" />
        <MetricCard label={t('teslaOnly.firmware', 'Firmware')} value={last?.version || unknown(t)} color="green" />
        <MetricCard label={t('teslaOnly.epochLatestStart', 'Latest first observed')} value={time(last?.started_at, t)} color="purple" />
      </Grid>
      <Text as="p" variant="caption">{t('teslaOnly.epochNote', 'FSD meter bounds are counter readings, not FSD engaged miles. An epoch ends when a different firmware value is observed. Missing readings can conceal intermediate versions.')}</Text>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.epochsBoundsKnown', 'Epochs with both FSD counter bounds: {{count}} / {{total}}', { count: bounded.length, total: epochs.length })}</Badge>
        <Badge variant="warning" size="sm">{t('teslaOnly.epochsCounterDrops', 'Epochs with lower final FSD counter: {{count}}', { count: counterDrops.length })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.epochsDwellKnown', 'Epochs with Complete-to-unplug value: {{count}}', { count: dwellObserved.length })}</Badge>
      </div>
      <Text as="p" variant="bodySm">{t('teslaOnly.epochsLatestChange', 'Latest epoch with two FSD counter bounds: {{version}} · signed change {{delta}}', {
        version: latestBounded?.version ?? unknown(t),
        delta: latestBounded?.fsd_meter_start_m != null && latestBounded.fsd_meter_end_m != null
          ? distance(latestBounded.fsd_meter_end_m - latestBounded.fsd_meter_start_m) : unknown(t),
      })}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.epochsChronology', 'Version observation chronology')}>
      {epochs.length === 0 && <Text as="p" variant="bodySm">{t('teslaOnly.epochsNoHistory', 'No firmware observations returned. Current version and intervening updates are unknown.')}</Text>}
      {epochs.map((row) => <div key={`${row.version}-${row.started_at}`} className="space-y-1 rounded-lg border border-[var(--glass-border)] p-3">
        <Text as="p" variant="bodySm">{row.version} · {time(row.started_at, t)} → {row.ended_at ? time(row.ended_at, t) : t('teslaOnly.currentEpoch', 'Latest observed version')}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.workbench.epochMeters', 'FSD counter: {{from}} → {{to}} · Complete → unplug: {{dwell}}', {
          from: distance(row.fsd_meter_start_m), to: distance(row.fsd_meter_end_m), dwell: seconds(row.complete_to_unplug_s, t),
        })}</Text><Text as="p" variant="caption">{row.honesty}</Text>
      </div>)}
      <Text as="p" variant="caption">{t('teslaOnly.epochsCaution', 'The first observation of a version is not its installation timestamp. Counter changes within or across epochs are not evidence of FSD use; compare meter resets before attributing a drop to an update.')}</Text>
      <Select label={t('teslaOnly.epochsFilter', 'Filter observed firmware version')} value={selected} onChange={(event) => setFilter(event.target.value)}
        options={[{ value: '', label: t('teslaOnly.epochsAll', 'All observed versions') }, ...versions.map((version) => ({ value: version, label: version }))]} />
      <RawRows title={physics.title} rows={[...visible].reverse()} tableId="physics:epochs" t={t}
        keyExtractor={(r) => `${r.version}-${r.started_at}`} mobileColumns={['version', 'started', 'ended']}
        columns={[
          { key: 'version', header: t('teslaOnly.firmware', 'Firmware'), render: (r) => r.version },
          { key: 'started', header: t('teslaOnly.started', 'Started'), render: (r) => time(r.started_at, t) },
          { key: 'ended', header: t('teslaOnly.ended', 'Ended'), render: (r) => time(r.ended_at, t) },
          { key: 'from', header: t('teslaOnly.before', 'Before'), render: (r) => distance(r.fsd_meter_start_m) },
          { key: 'to', header: t('teslaOnly.after', 'After'), render: (r) => distance(r.fsd_meter_end_m) },
          { key: 'dwell', header: t('teslaOnly.unplug', 'Complete → unplug'), render: (r) => seconds(r.complete_to_unplug_s, t) },
        ]} />
    </Evidence>
  </>;
}
