import { useState } from 'react';
import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { Badge, DataTable, Select } from '@/components/ui';

import type { ClockReading } from '@/types/teslaPhysics';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, pagination, seconds, unknown, yesNo } from './PhysicsPageShell';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function PhysicsClocksSection({ physics }: { physics: PhysicsPage }) {
  const { fmtNumber } = useNumberFormatting();
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
    { key: 'lag', align: 'right' as const, header: t('teslaOnly.clocksLag', 'Stored ingest lag'), render: (row: ClockReading) => {
      const value = lagFor(row);
      return value == null ? unknown(t) : `${fmtNumber(value)} s`;
    } },
    { key: 'gap', align: 'right' as const, header: t('teslaOnly.elapsedSinceEvent', 'Elapsed since prior event'), render: (row: ClockReading) => seconds(row.gap_s, t) },
    { key: 'display', header: t('teslaOnly.displayTime', 'Display time'), render: (row: ClockReading) => preciseTime(row.display_time) },
    { key: 'unknown', header: t('teslaOnly.unknownFlag', 'Unknown flag'), render: (row: ClockReading) => yesNo(row.unknown, t) },
  ];
  return <>
    <Evidence title={physics.title} honesty={clock?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-clocks-summary" available={clock != null}
        description={t('teslaOnly.clocksAnalysis', 'Lag is ingest minus event time for paired timestamps; negative values can reflect clock disagreement. Intervals are gaps between returned events, not proven outages. Display time is generated on read. Compare unknown OS and car kept living.')}
        metrics={[
          { metricId: 'text', occurrenceId: 'event', label: t('teslaOnly.eventTime', 'Event time'), rawValue: latest?.event_time == null ? null : preciseTime(latest.event_time), context: latest?.event_time },
          { metricId: 'text', occurrenceId: 'ingest', label: t('teslaOnly.ingestTime', 'Ingest time'), rawValue: latest?.ingest_time == null ? null : preciseTime(latest.ingest_time), context: latest?.ingest_time },
          { metricId: 'text', occurrenceId: 'display', label: t('teslaOnly.displayTime', 'Display time'), rawValue: latest?.display_time == null ? null : preciseTime(latest.display_time), context: latest?.display_time },
          { metricId: 'duration', occurrenceId: 'median-lag', label: t('teslaOnly.clocksLagMedian', 'Median stored ingest lag'), rawValue: medianLag, display: { formatter: raw => ({ value: `${fmtNumber(raw)} s`, unit: '' }) } },
          { metricId: 'duration', occurrenceId: 'max-lag', label: t('teslaOnly.clocksLagMax', 'Largest stored ingest lag'), rawValue: maximum(lag), display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) } },
          { metricId: 'duration', occurrenceId: 'min-lag', label: t('teslaOnly.clocksLagMin', 'Smallest stored ingest lag'), rawValue: lag[0], display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) }, context: t('teslaOnly.clocksLagRange', 'Stored lag range: {{from}} → {{to}}', { from: seconds(lag[0], t), to: seconds(maximum(lag), t) }) },
          { metricId: 'duration', occurrenceId: 'max-gap', label: t('teslaOnly.clocksGapMax', 'Largest returned event interval'), rawValue: maximum(gaps), display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) } },
          { metricId: 'count', occurrenceId: 'over-five', label: t('teslaOnly.clocksGapsFive', 'Intervals over five minutes'), rawValue: gaps.length ? longGaps : null },
          { metricId: 'count', occurrenceId: 'short', label: t('teslaOnly.clocksShortGaps', 'At most 60 s'), rawValue: clock ? shortGaps : null, context: `${t('teslaOnly.clocksShortGaps', 'At most 60 s')}: ${clock ? shortGaps : unknown(t)}` },
          { metricId: 'count', occurrenceId: 'medium', label: t('teslaOnly.clocksMediumGaps', 'Over 60 s through 5 min'), rawValue: clock ? mediumGaps : null, context: `${t('teslaOnly.clocksMediumGaps', 'Over 60 s through 5 min')}: ${clock ? mediumGaps : unknown(t)}` },
          { metricId: 'count', occurrenceId: 'long', label: t('teslaOnly.clocksLongGaps', 'Over 5 min'), rawValue: clock ? longGaps : null, context: `${t('teslaOnly.clocksLongGaps', 'Over 5 min')}: ${clock ? longGaps : unknown(t)}` },
          { metricId: 'count', occurrenceId: 'unknown', label: t('teslaOnly.clocksMissingGaps', 'Unknown interval'), rawValue: clock ? rows.length - gaps.length : null, context: `${t('teslaOnly.clocksMissingGaps', 'Unknown interval')}: ${clock ? rows.length - gaps.length : unknown(t)}` },
          { metricId: 'count', occurrenceId: 'paired', label: t('teslaOnly.ingestTime', 'Ingest time'), rawValue: clock ? lag.length : null, display: { countTotal: rows.length }, context: t('teslaOnly.workbench.ingestCoverage', 'Stored ingest timestamps: {{known}} / {{total}}', { known: lag.length, total: rows.length }) },
          { metricId: 'count', occurrenceId: 'known-gaps', label: t('teslaOnly.elapsedSinceEvent', 'Elapsed since prior event'), rawValue: clock ? gaps.length : null, display: { countTotal: rows.length }, context: t('teslaOnly.clocksKnownGaps', 'Known event intervals: {{count}} / {{total}}', { count: gaps.length, total: rows.length }) },
        ]} />
      <div className="flex flex-wrap gap-2">
        {latest?.unknown && <Badge variant="warning" size="sm">{t('teslaOnly.workbench.latestFlag', 'Latest reading flagged unknown')}</Badge>}
      </div>
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
