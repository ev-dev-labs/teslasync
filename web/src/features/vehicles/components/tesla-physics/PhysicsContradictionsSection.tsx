import { useState } from 'react';
import { MetricCard } from '@/components/data-display';
import { Select } from '@/components/ui';
import { Grid } from '@/components/layout';
import { Badge, DataTable, Text } from '@/components/ui';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, pagination, time, yesNo } from './PhysicsPageShell';

export default function PhysicsContradictionsSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const findings = report?.contradictions?.findings ?? [];
  const [filter, setFilter] = useState('');
  const [uncertainty, setUncertainty] = useState('all');
  const kinds = [...new Set(findings.map((r) => r.kind))].sort();
  const selected = kinds.includes(filter) ? filter : '';
  const episodes = findings.filter((r) => (!selected || r.kind === selected) &&
    (uncertainty === 'all' || r.unknown === (uncertainty === 'unknown')));
  const observations = findings.reduce((count, r) => count + (r.observations ?? 1), 0);
  const unknownCount = findings.filter((r) => r.unknown).length;
  const mostRecent = [...episodes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const port = report?.charge_port_court?.evidence ?? [];
  const eventTime = mostRecent ? Date.parse(mostRecent.at) : NaN;
  const nearbyPort = port.filter((row) => Number.isFinite(eventTime) &&
    Number.isFinite(Date.parse(row.at)) && Math.abs(Date.parse(row.at) - eventTime) <= 120_000)
    .sort((a, b) => Math.abs(Date.parse(a.at) - eventTime) - Math.abs(Date.parse(b.at) - eventTime))[0];
  return <>
    <Evidence title={physics.title} honesty={report?.contradictions?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.contradictionEpisodes', 'Returned episodes')} value={findings.length} color="amber" />
        <MetricCard label={t('teslaOnly.workbench.observations', 'Reported observations')} value={observations} color="cyan" />
        <MetricCard label={t('teslaOnly.contradictionUncertain', 'Unknown-flagged episodes')} value={unknownCount} color="purple" />
      </Grid>
      <Text as="p" variant="caption">{t('teslaOnly.contradictionAnalysis', 'The backend groups consecutive matching findings into episodes. Observations count repeated readings, not separate faults. The first and last times bound observed repetitions, not the precise onset or resolution. Missing history and source caps can hide episodes.')}</Text>
      <div className="flex flex-wrap gap-2">{kinds.map((kind) => <Badge key={kind} variant="neutral" size="sm">
        {t('teslaOnly.contradictionByKind', '{{kind}}: {{episodes}} episodes / {{readings}} readings', {
          kind, episodes: findings.filter((r) => r.kind === kind).length,
          readings: findings.filter((r) => r.kind === kind).reduce((sum, r) => sum + (r.observations ?? 1), 0),
        })}
      </Badge>)}</div>
    </Evidence>
    <Evidence title={t('teslaOnly.contradictionRecent', 'Latest eight episodes; open raw evidence for the full returned set.')}>
      <Select label={t('teslaOnly.filterKind', 'Filter by finding')} value={selected} onChange={(event) => setFilter(event.target.value)}
        options={[{ value: '', label: t('teslaOnly.allFindings', 'All findings') }, ...kinds.map((kind) => ({ value: kind, label: kind }))]} />
      <Select label={t('teslaOnly.contradictionCertainty', 'Filter by uncertainty')} value={uncertainty} onChange={(event) => setUncertainty(event.target.value)}
        options={[
          { value: 'all', label: t('teslaOnly.allFindings', 'All findings') },
          { value: 'unknown', label: t('teslaOnly.contradictionUnknownOnly', 'Unknown-flagged episodes') },
          { value: 'known', label: t('teslaOnly.contradictionKnownOnly', 'Unflagged episodes') },
        ]} />
      {mostRecent && <div className="space-y-2 rounded-lg border border-[var(--glass-border)] p-3">
        <Text as="p" variant="bodySm">{t('teslaOnly.contradictionLatest', 'Latest matching episode: {{kind}} · {{count}} observed readings', {
          kind: mostRecent.kind, count: mostRecent.observations ?? 1,
        })}</Text>
        <Text as="p" variant="bodySm">{mostRecent.detail}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.contradictionPortContext', 'Nearest port sample within two minutes: {{at}} · state {{state}} · latch {{latch}} · gear {{gear}}', {
          at: time(nearbyPort?.at, t), state: nearbyPort?.charge_state || t('teslaOnly.unknown', 'unknown'),
          latch: nearbyPort?.latch || t('teslaOnly.unknown', 'unknown'), gear: nearbyPort?.gear || t('teslaOnly.unknown', 'unknown'),
        })}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.contradictionPortCaution', 'Proximity is context, not a synchronous reading or proof of which signal was wrong.')}</Text>
      </div>}
      {episodes.length ? <DataTable tableId="physics:episodes" data={[...episodes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8)} pagination={pagination}
        mobileColumns={['kind', 'window', 'observations']} keyExtractor={(r) => `${r.at}-${r.kind}-${r.detail}`} columns={[
          { key: 'kind', header: t('teslaOnly.kind', 'Kind'), render: (r) => r.kind },
          { key: 'window', header: t('teslaOnly.workbench.episodeWindow', 'First → last'), render: (r) => `${time(r.at, t)} → ${time(r.last_at ?? r.at, t)}` },
          { key: 'observations', header: t('teslaOnly.workbench.observations', 'Reported observations'), render: (r) => r.observations ?? 1 },
          { key: 'detail', header: t('teslaOnly.detail', 'Detail'), render: (r) => r.detail },
          { key: 'unknown', header: t('teslaOnly.unknownFlag', 'Unknown flag'), render: (r) => yesNo(r.unknown, t) },
        ]} emptyMessage={t('teslaOnly.noMatchingFindings', 'No findings match this filter.')} /> :
        <Text as="p" variant="bodySm">{t('teslaOnly.noContradictions', 'No contradictions in the returned window. Complete still latched is expected.')}</Text>}
      <Text as="p" variant="caption">{t('teslaOnly.conflictNote', 'Compare with charge-port and motion evidence before deciding which sensor is wrong.')}</Text>
      <RawRows title={physics.title} rows={[...findings].reverse()} tableId="physics:findings" t={t}
        disclosureLabel={t('teslaOnly.contradictionAllEpisodes', 'Inspect all {{count}} returned episodes', { count: findings.length })}
        description={t('teslaOnly.contradictionNoRaw', 'These rows are already grouped by the backend. Individual source readings are not included in this report; the observation count is their aggregate.')}
        keyExtractor={(r) => `${r.at}-${r.kind}-${r.detail}`} columns={[
          { key: 'at', header: t('teslaOnly.started', 'Started'), render: (r) => time(r.at, t) },
          { key: 'last', header: t('teslaOnly.ended', 'Ended'), render: (r) => time(r.last_at ?? r.at, t) },
          { key: 'kind', header: t('teslaOnly.kind', 'Kind'), render: (r) => r.kind },
          { key: 'detail', header: t('teslaOnly.detail', 'Detail'), render: (r) => r.detail },
        ]} />
    </Evidence>
  </>;
}
