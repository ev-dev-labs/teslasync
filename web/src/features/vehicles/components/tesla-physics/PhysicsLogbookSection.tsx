import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, DataTable, Select, Text } from '@/components/ui';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, pagination, time } from './PhysicsPageShell';
import type { LogbookEntry } from '@/types/teslaPhysics';

export default function PhysicsLogbookSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const log = report?.logbook;
  const entries = log?.entries ?? [];
  const states = entries.filter((r) => r.kind === 'gear' || r.kind === 'charge_state');
  const sessions = entries.filter((r) => (r.kind === 'drive' || r.kind === 'charge') && r.id > 0);
  const kinds = [...new Set(entries.map((r) => r.kind))];
  const [filter, setFilter] = useState('');
  const selected = kinds.includes(filter) ? filter : '';
  const visible = selected ? entries.filter((entry) => entry.kind === selected) : entries;
  const orderedStates = [...states].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const firstGear = orderedStates.find((row) => row.kind === 'gear');
  const firstCharge = orderedStates.find((row) => row.kind === 'charge_state');
  const lastGear = [...orderedStates].reverse().find((row) => row.kind === 'gear');
  const lastCharge = [...orderedStates].reverse().find((row) => row.kind === 'charge_state');
  const unlinked = entries.filter((row) => (row.kind === 'drive' || row.kind === 'charge') && row.id <= 0).length;
  const word = (row: LogbookEntry) => (row.kind === 'drive' || row.kind === 'charge') && row.id > 0
    ? <Link to={`/${row.kind === 'drive' ? 'drives' : 'charging'}/${row.id}`} className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{row.word} →</Link> : row.word;
  const columns = [
    { key: 'word', header: t('teslaOnly.word', 'Word'), render: word },
    { key: 'kind', header: t('teslaOnly.kind', 'Kind'), render: (r: LogbookEntry) => r.kind },
    { key: 'at', header: t('teslaOnly.started', 'Started'), render: (r: LogbookEntry) => time(r.at, t) },
    { key: 'ended', header: t('teslaOnly.ended', 'Ended'), render: (r: LogbookEntry) => time(r.ended_at, t) },
  ];
  return <>
    <Evidence title={physics.title} honesty={log?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.logbookEntries', 'Returned entries')} value={entries.length} color="cyan" />
        <MetricCard label={t('teslaOnly.historicalWords', 'Recorded gear / charge-state entries')} value={states.length} color="green" />
        <MetricCard label={t('teslaOnly.sessionWords', 'Session-boundary entries')} value={sessions.length} color="amber" />
      </Grid>
      <div className="flex flex-wrap gap-2">{kinds.map((kind) =>
        <Badge key={kind} variant="neutral" size="sm">{kind}: {entries.filter((r) => r.kind === kind).length}</Badge>)}</div>
      <Text as="p" variant="bodySm">{t('teslaOnly.logbookFirst', 'First recorded gear: {{gear}} · first charge state: {{charge}}', {
        gear: firstGear?.word || t('teslaOnly.unknown', 'unknown'), charge: firstCharge?.word || t('teslaOnly.unknown', 'unknown'),
      })}</Text>
      <Text as="p" variant="bodySm">{t('teslaOnly.logbookLast', 'Last recorded gear: {{gear}} · last charge state: {{charge}}', {
        gear: lastGear?.word || t('teslaOnly.unknown', 'unknown'), charge: lastCharge?.word || t('teslaOnly.unknown', 'unknown'),
      })}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.logbookUnlinked', '{{count}} session-like entries have no positive session ID and cannot link to a recorded session.', { count: unlinked })}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.logbookNote', 'Observed historical gear and charge-state changes appear beside drive and charge session boundaries. The first recorded value establishes observed state, not the exact transition time. Synthetic live state is excluded when recorded entries exist and appears only as a fallback when there are none. Gaps and unobserved changes remain unknown.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.logbookNarrative', 'Observed narrative and session drilldowns')}>
      {entries.length === 0 && <Text as="p" variant="bodySm">{t('teslaOnly.logbookNoEntries', 'No historical changes or session boundaries returned in the bounded window. Unobserved states remain unknown.')}</Text>}
      <Text as="p" variant="bodySm">{t('teslaOnly.workbench.recentEntries', 'Latest recorded entries')}</Text>
      <DataTable tableId="physics:logbook-recent" data={entries.slice(-8).reverse()} columns={columns} pagination={pagination}
        mobileColumns={['word', 'at']} keyExtractor={(r) => `${r.kind}-${r.id}-${r.at}-${r.word}`}
        emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')} />
      <Select label={t('teslaOnly.logbookFilter', 'Filter narrative by evidence kind')} value={selected} onChange={(event) => setFilter(event.target.value)}
        options={[{ value: '', label: t('teslaOnly.logbookAll', 'All returned entries') }, ...kinds.map((kind) => ({ value: kind, label: kind }))]} />
      <RawRows title={physics.title} rows={[...visible].reverse()} columns={columns} tableId="physics:logbook"
        mobileColumns={['word', 'at']} keyExtractor={(r) => `${r.kind}-${r.id}-${r.at}-${r.word}`} t={t} />
    </Evidence>
  </>;
}
