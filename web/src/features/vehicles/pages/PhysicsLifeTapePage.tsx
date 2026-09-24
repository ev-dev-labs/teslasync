import { useState } from 'react';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Select, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { Evidence, RawRows } from '../components/tesla-physics/Evidence';
import { PhysicsPageShell, seconds, time, usePhysicsPage } from '../components/tesla-physics/PhysicsPageShell';

export default function PhysicsLifeTapePage() {
  const physics = usePhysicsPage('life-tape');
  const { report, t } = physics;
  const tape = report?.life_tape;
  const segments = tape?.segments ?? [];
  const [filter, setFilter] = useState('');
  const byState = new Map<string, { duration: number; count: number }>();
  for (const row of segments) {
    const previous = byState.get(row.state) ?? { duration: 0, count: 0 };
    byState.set(row.state, { duration: previous.duration + Math.max(0, row.duration_s), count: previous.count + 1 });
  }
  const states = [...byState.entries()].sort((a, b) => b[1].duration - a[1].duration);
  const total = states.reduce((sum, [, item]) => sum + item.duration, 0);
  const selected = byState.has(filter) ? filter : '';
  const visible = selected ? segments.filter((row) => row.state === selected) : segments;
  const from = tape?.from ? Date.parse(tape.from) : NaN;
  const to = tape?.to ? Date.parse(tape.to) : NaN;
  const windowS = Number.isFinite(from) && Number.isFinite(to) && to > from ? (to - from) / 1000 : null;
  const classifiedShare = segments.length > 0 && windowS != null && total <= windowS ? 100 * total / windowS : null;
  const longest = segments.length ? segments.reduce((a, b) => a.duration_s >= b.duration_s ? a : b) : null;
  return <PhysicsPageShell physics={physics}>
    <Evidence title={physics.title} honesty={tape?.honesty}>
      <Text as="p" variant="bodySm">{t('teslaOnly.lifeWindow', 'Observed window: {{from}} to {{to}}', { from: time(tape?.from, t), to: time(tape?.to, t) })}</Text>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.segmentCount', 'Classified intervals')} value={segments.length} color="cyan" />
        <MetricCard label={t('teslaOnly.lifeClassified', 'Returned interval duration')} value={segments.length ? seconds(total, t) : t('teslaOnly.unknown', 'unknown')} color="green" />
        <MetricCard label={t('teslaOnly.unclassifiedTime', 'Unclassified time')} value={byState.has('unknown') ? seconds(byState.get('unknown')?.duration, t) : t('teslaOnly.unknown', 'unknown')} color="amber" />
      </Grid>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.lifeShare', 'Sum of classified intervals / returned window: {{value}}', {
          value: classifiedShare == null ? t('teslaOnly.unknown', 'unknown') : `${fmtNumber(classifiedShare, 1)}%`,
        })}</Badge>
        {windowS != null && total > windowS && <Badge variant="warning" size="sm">{t('teslaOnly.lifeOverlap', 'Intervals sum beyond the window; no coverage percentage is inferred')}</Badge>}
      </div>
      <Text as="p" variant="caption">{t('teslaOnly.lifeShareCaution', 'Classified interval duration is not telemetry completeness. Unclassified time may be absent from the returned intervals; do not treat the remainder as parked or driving.')}</Text>
      <div className="space-y-2">{states.map(([name, item]) => <div key={name} className="rounded-lg border border-[var(--glass-border)] p-3">
        <div className="flex justify-between gap-2"><Text as="span" variant="bodySm">{name}</Text>
          <Badge variant={name === 'unknown' ? 'warning' : 'neutral'} size="sm">{seconds(item.duration, t)} · {total > 0 ? `${fmtNumber(100 * item.duration / total, 1)}%` : t('teslaOnly.unknown', 'unknown')}</Badge></div>
        <Text as="p" variant="caption">{t('teslaOnly.lifeIntervals', '{{count}} returned intervals', { count: item.count })}</Text>
      </div>)}</div>
      <Text as="p" variant="caption">{t('teslaOnly.workbench.tapeCaution', 'State durations classify the returned window, not GPS distance. Neutral rolling is not confirmed Park; gaps stay Unknown.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.lifeTimeline', 'Longest interval and state chronology')}>
      {longest ? <Text as="p" variant="bodySm">{t('teslaOnly.lifeLongest', 'Longest returned interval: {{state}} for {{duration}}, {{from}} → {{to}}', {
        state: longest.state, duration: seconds(longest.duration_s, t),
        from: time(longest.started_at, t), to: time(longest.ended_at, t),
      })}</Text> : <Text as="p" variant="bodySm">{t('teslaOnly.lifeNoIntervals', 'No classified intervals returned. The report cannot reconstruct a state chronology for this window.')}</Text>}
      {segments.length > 0 && segments.slice(-5).reverse().map((row) =>
        <Text key={`${row.started_at}-${row.state}`} as="p" variant="bodySm">{t('teslaOnly.lifeChronologyRow', '{{state}}: {{from}} → {{to}} ({{duration}})', {
          state: row.state, from: time(row.started_at, t), to: time(row.ended_at, t), duration: seconds(row.duration_s, t),
        })}</Text>)}
      <Select label={t('teslaOnly.filterState', 'Filter by state')} value={selected} onChange={(event) => setFilter(event.target.value)}
        options={[{ value: '', label: t('teslaOnly.allStates', 'All states') }, ...states.map(([name]) => ({ value: name, label: name }))]} />
      <RawRows title={physics.title} rows={[...visible].reverse()} tableId="physics:tape" t={t} mobileColumns={['state', 'duration', 'started']}
        keyExtractor={(row) => `${row.started_at}-${row.state}`} columns={[
          { key: 'state', header: t('teslaOnly.state', 'State'), render: (r) => r.state },
          { key: 'started', header: t('teslaOnly.started', 'Started'), render: (r) => time(r.started_at, t) },
          { key: 'ended', header: t('teslaOnly.ended', 'Ended'), render: (r) => time(r.ended_at, t) },
          { key: 'duration', header: t('teslaOnly.duration', 'Duration'), render: (r) => seconds(r.duration_s, t) },
        ]} />
    </Evidence>
  </PhysicsPageShell>;
}
