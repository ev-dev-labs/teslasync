import { useState } from 'react';
import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { Select, Text } from '@/components/ui';

import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, time, unknown, yesNo } from './PhysicsPageShell';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function PhysicsChargePortSection({ physics }: { physics: PhysicsPage }) {
  const { fmtNumber } = useNumberFormatting();
  const { report, t } = physics;
  const port = report?.charge_port_court;
  const rows = port?.evidence ?? [];
  const byState = [...new Set(rows.map((r) => r.charge_state || unknown(t)))];
  const noCurrent = rows.filter((r) => r.pack_current_a == null).length;
  const [filter, setFilter] = useState('');
  const selected = byState.includes(filter) ? filter : '';
  const ordered = [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = ordered.length ? ordered[ordered.length - 1] : undefined;
  const transitions = ordered.filter((row, index) => index > 0 && row.charge_state !== ordered[index - 1].charge_state);
  const disconnected = rows.filter((row) => row.charge_state === 'Disconnected').length;
  const visible = selected ? ordered.filter((row) => (row.charge_state || unknown(t)) === selected) : ordered;
  const columns = [
    { key: 'at', header: t('teslaOnly.started', 'Started'), render: (r: typeof rows[number]) => time(r.at, t) },
    { key: 'state', header: t('teslaOnly.chargeState', 'Charge state'), render: (r: typeof rows[number]) => r.charge_state || unknown(t) },
    { key: 'gear', header: t('teslaOnly.gear', 'Gear'), render: (r: typeof rows[number]) => r.gear || unknown(t) },
    { key: 'firmware', header: t('teslaOnly.firmware', 'Firmware'), render: (r: typeof rows[number]) => r.firmware || unknown(t) },
    { key: 'current', align: 'right' as const, header: t('teslaOnly.packCurrent', 'Pack current'), render: (r: typeof rows[number]) => r.pack_current_a == null ? unknown(t) : `${fmtNumber(r.pack_current_a)} A` },
    { key: 'latch', header: t('teslaOnly.latch', 'Latch'), render: (r: typeof rows[number]) => r.latch || unknown(t) },
    { key: 'door', header: t('teslaOnly.door', 'Door'), render: (r: typeof rows[number]) => yesNo(r.door_open, t) },
    { key: 'schedule', header: t('teslaOnly.scheduleMode', 'Schedule mode'), render: (r: typeof rows[number]) => r.scheduled_mode || unknown(t) },
  ];
  return <>
    <Evidence title={physics.title} honesty={port?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-port-summary" available={port != null}
        description={t('teslaOnly.portNote', 'Compare adjacent state, latch, current, and schedule samples before treating a paused charge as unplugged. Only Disconnected marks unplugging. Park and firmware come from the same returned reading, not a continuous signal.')}
        metrics={[
          { metricId: 'count', occurrenceId: 'samples', label: t('teslaOnly.portSamples', 'Returned port samples'), rawValue: port ? rows.length : null },
          { metricId: 'status', occurrenceId: 'state', label: t('teslaOnly.workbench.latestChargeState', 'Latest returned charge state'), rawValue: last?.charge_state || null, context: time(last?.at, t) },
          { metricId: 'number', occurrenceId: 'current', label: t('teslaOnly.workbench.latestCurrent', 'Latest returned pack current'), rawValue: last?.pack_current_a, display: { formatter: raw => ({ value: `${fmtNumber(raw)} A`, unit: '' }) }, context: time(last?.at, t) },
          { metricId: 'count', occurrenceId: 'missing-current', label: t('teslaOnly.portUnknownCurrentLabel', 'Samples without current'), rawValue: port ? noCurrent : null, context: t('teslaOnly.portUnknownCurrent', 'Samples without current: {{count}}', { count: noCurrent }) },
          ...byState.map((state): import('@/components/data-display').StatMetric => ({ metricId: 'count', occurrenceId: `state-${state}`, label: state, rawValue: rows.filter(row => (row.charge_state || unknown(t)) === state).length })),
        ]} />
      <Text as="p" variant="bodySm">{t('teslaOnly.workbench.portContext', 'Latest gear {{gear}} · firmware {{firmware}} · latch {{latch}} · schedule {{schedule}}', {
        gear: last?.gear || unknown(t), firmware: last?.firmware || unknown(t), latch: last?.latch || unknown(t), schedule: last?.scheduled_mode || unknown(t),
      })}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.portTransitions', 'Charge-port transitions and schedule context')}>
      <PhysicsEvidenceBrief physics={physics} id="physics-port-transitions" available={port != null}
        metrics={[
          { metricId: 'count', occurrenceId: 'changes', label: t('teslaOnly.portChangesLabel', 'Observed charge-state changes'), rawValue: port ? transitions.length : null, context: t('teslaOnly.portChanges', 'Observed charge-state changes: {{count}}', { count: transitions.length }) },
          { metricId: 'count', occurrenceId: 'disconnected', label: t('teslaOnly.portDisconnectsLabel', 'Disconnected readings'), rawValue: port ? disconnected : null, context: t('teslaOnly.portDisconnects', 'Disconnected readings: {{count}}', { count: disconnected }) },
          { metricId: 'text', occurrenceId: 'schedule', label: t('teslaOnly.scheduleMode', 'Schedule mode'), rawValue: last?.scheduled_mode || null, context: <>{time(last?.at, t)}<div>{t('teslaOnly.portSchedule', 'Latest recorded schedule: {{value}}', { value: last?.scheduled_mode || unknown(t) })}</div></> },
        ]} />
      {transitions.length ? transitions.slice(-5).reverse().map((row) => <Text key={row.at} as="p" variant="bodySm">
        {t('teslaOnly.portChangeReading', '{{at}}: {{state}} · latch {{latch}} · gear {{gear}} · current {{current}}', {
          at: time(row.at, t), state: row.charge_state || unknown(t), latch: row.latch || unknown(t),
          gear: row.gear || unknown(t), current: row.pack_current_a == null ? unknown(t) : `${fmtNumber(row.pack_current_a)} A`,
        })}</Text>) : <Text as="p" variant="bodySm">{t('teslaOnly.portNoTransitions', 'No charge-state change among returned samples. The first reading is an observed state; missing samples cannot rule out transitions.')}</Text>}
      <Select label={t('teslaOnly.portFilter', 'Filter charge-port samples by state')} value={selected} onChange={(event) => setFilter(event.target.value)}
        options={[{ value: '', label: t('teslaOnly.portAllStates', 'All returned states') }, ...byState.map((state) => ({ value: state, label: state }))]} />
      <RawRows title={physics.title} rows={[...visible].reverse()} columns={columns} tableId="physics:port" t={t}
        mobileColumns={['at', 'state', 'gear', 'firmware', 'latch']} keyExtractor={(r) => r.at} />
    </Evidence>
  </>;
}
