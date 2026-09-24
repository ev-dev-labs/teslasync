import { useState } from 'react';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, DataTable, Select, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type { ClockReading } from '@/types/teslaPhysics';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, pagination, seconds, unknown, yesNo } from './PhysicsPageShell';

export default function PhysicsClocksSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const clock = report?.clocks;
  const rows = clock?.samples ?? [];
  const latest = clock?.latest;
  const [gapFilter, setGapFilter] = useState('all');
  const preciseTime = (value: string | null | undefined) => {
    if (!value) return unknown(t);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? unknown(t) : date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };
  const lagFor = (row: ClockReading) => {
    const event = Date.parse(row.event_time);
    const ingest = row.ingest_time ? Date.parse(row.ingest_time) : NaN;
    return Number.isFinite(event) && Number.isFinite(ingest) ? (ingest - event) / 1000 : null;
  };
  const lag = rows.flatMap((row) => {
    const value = lagFor(row);
    return value == null ? [] : [value];
  }).sort((a, b) => a - b);
  const gaps = rows.flatMap((row) => row.gap_s != null && row.gap_s >= 0 ? [row.gap_s] : []).sort((a, b) => a - b);
  const medianLag = lag.length ? (lag[Math.floor((lag.length - 1) / 2)] + lag[Math.floor(lag.length / 2)]) / 2 : null;
  const maximum = (values: number[]) => values.length ? values[values.length - 1] : null;
  const longGaps = gaps.filter((gap) => gap > 300).length;
  const mediumGaps = gaps.filter((gap) => gap > 60 && gap <= 300).length;
  const shortGaps = gaps.filter((gap) => gap <= 60).length;
  const filtered = rows.filter((row) => gapFilter === 'all' ||
    (gapFilter === 'over300' && row.gap_s != null && row.gap_s > 300) ||
    (gapFilter === 'over60' && row.gap_s != null && row.gap_s > 60) ||
    (gapFilter === 'missing' && (row.gap_s == null || row.gap_s < 0)));
  const columns = [
    { key: 'event', header: t('teslaOnly.eventTime', 'Event time'), render: (row: ClockReading) => preciseTime(row.event_time) },
    { key: 'ingest', header: t('teslaOnly.ingestTime', 'Ingest time'), render: (row: ClockReading) => preciseTime(row.ingest_time) },
    { key: 'lag', header: t('teslaOnly.clocksLag', 'Stored ingest lag'), render: (row: ClockReading) => {
      const value = lagFor(row);
      return value == null ? unknown(t) : `${fmtNumber(value, 1)} s`;
    } },
    { key: 'gap', header: t('teslaOnly.elapsedSinceEvent', 'Elapsed since prior event'), render: (row: ClockReading) => seconds(row.gap_s, t) },
    { key: 'display', header: t('teslaOnly.displayTime', 'Display time'), render: (row: ClockReading) => preciseTime(row.display_time) },
    { key: 'unknown', header: t('teslaOnly.unknownFlag', 'Unknown flag'), render: (row: ClockReading) => yesNo(row.unknown, t) },
  ];
  return <>
    <Evidence title={physics.title} honesty={clock?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.eventTime', 'Event time')} value={preciseTime(latest?.event_time)} color="cyan" />
        <MetricCard label={t('teslaOnly.ingestTime', 'Ingest time')} value={preciseTime(latest?.ingest_time)} color="amber" />
        <MetricCard label={t('teslaOnly.displayTime', 'Display time')} value={preciseTime(latest?.display_time)} color="purple" />
      </Grid>
      <Grid cols={{ default: 1, md: 2, xl: 4 }} gap={3}>
        <MetricCard label={t('teslaOnly.clocksLagMedian', 'Median stored ingest lag')} value={medianLag == null ? unknown(t) : `${fmtNumber(medianLag, 1)} s`} color="cyan" />
        <MetricCard label={t('teslaOnly.clocksLagMax', 'Largest stored ingest lag')} value={seconds(maximum(lag), t)} color="amber" />
        <MetricCard label={t('teslaOnly.clocksGapMax', 'Largest returned event interval')} value={seconds(maximum(gaps), t)} color="purple" />
        <MetricCard label={t('teslaOnly.clocksGapsFive', 'Intervals over five minutes')} value={gaps.length ? longGaps : unknown(t)} color="green" />
      </Grid>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [t('teslaOnly.clocksShortGaps', 'At most 60 s'), shortGaps],
          [t('teslaOnly.clocksMediumGaps', 'Over 60 s through 5 min'), mediumGaps],
          [t('teslaOnly.clocksLongGaps', 'Over 5 min'), longGaps],
          [t('teslaOnly.clocksMissingGaps', 'Unknown interval'), rows.length - gaps.length],
        ].map(([label, count]) => <div key={label} className="rounded-lg border border-[var(--glass-border)] p-3">
          <Text as="p" variant="bodySm">{label}: {count}</Text>
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.workbench.ingestCoverage', 'Stored ingest timestamps: {{known}} / {{total}}', { known: lag.length, total: rows.length })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.clocksKnownGaps', 'Known event intervals: {{count}} / {{total}}', { count: gaps.length, total: rows.length })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.clocksLagRange', 'Stored lag range: {{from}} → {{to}}', { from: seconds(lag[0], t), to: seconds(maximum(lag), t) })}</Badge>
        {latest?.unknown && <Badge variant="warning" size="sm">{t('teslaOnly.workbench.latestFlag', 'Latest reading flagged unknown')}</Badge>}
      </div>
      <Text as="p" variant="caption">{t('teslaOnly.clocksAnalysis', 'Lag is ingest minus event time for paired timestamps; negative values can reflect clock disagreement. Intervals are gaps between returned events, not proven outages. Display time is generated on read. Compare Unknown OS and Car Kept Living.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.clocksRecent', 'Latest six returned samples (second precision)')}>
      <DataTable tableId="physics:clocks-recent" data={rows.slice(-6).reverse()} columns={columns} pagination={pagination}
        keyExtractor={(row) => row.event_time} mobileColumns={['event', 'lag', 'gap']}
        emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')} />
      <Select label={t('teslaOnly.clocksFilter', 'Filter event intervals')} value={gapFilter} onChange={(event) => setGapFilter(event.target.value)}
        options={[
          { value: 'all', label: t('teslaOnly.clocksAll', 'All returned samples') },
          { value: 'over60', label: t('teslaOnly.clocksOver60', 'Over one minute') },
          { value: 'over300', label: t('teslaOnly.clocksOver300', 'Over five minutes') },
          { value: 'missing', label: t('teslaOnly.clocksMissing', 'Unknown interval') },
        ]} />
      <RawRows title={physics.title} rows={[...filtered].reverse()} tableId="physics:clocks" t={t} keyExtractor={(row) => row.event_time}
        mobileColumns={['event', 'lag', 'gap']} columns={columns} />
    </Evidence>
  </>;
}
